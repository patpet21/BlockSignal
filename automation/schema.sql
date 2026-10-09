-- BlockSignal automation v1. Apply to a dedicated PostgreSQL database as its owner.
-- Functions are invoker-security; n8n must use a dedicated non-superuser login.
CREATE SCHEMA IF NOT EXISTS blocksignal;
REVOKE ALL ON SCHEMA blocksignal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS blocksignal.properties (
  workspace text NOT NULL CHECK (workspace ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  building_id text NOT NULL CHECK (building_id ~ '^[0-9]{1,12}$'),
  address text NOT NULL CHECK (length(address) BETWEEN 1 AND 300),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_due timestamptz NOT NULL DEFAULT now(),
  lease_token text, lease_until timestamptz,
  last_checked timestamptz, snapshot jsonb, revision bigint NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0, last_error text, outage_notified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace, building_id)
);
CREATE INDEX IF NOT EXISTS properties_due ON blocksignal.properties (workspace, next_due) WHERE active;

CREATE TABLE IF NOT EXISTS blocksignal.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace text NOT NULL, building_id text NOT NULL, revision bigint NOT NULL,
  record_id text NOT NULL, kind text NOT NULL, priority text NOT NULL,
  payload jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace, building_id, revision, record_id, kind),
  FOREIGN KEY (workspace, building_id) REFERENCES blocksignal.properties (workspace, building_id)
);
CREATE INDEX IF NOT EXISTS events_history ON blocksignal.events (workspace, building_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS blocksignal.outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace text NOT NULL, building_id text NOT NULL, revision bigint NOT NULL,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
  lease_token text, lease_until timestamptz, delivered_at timestamptz, cancelled_at timestamptz, last_error text,
  UNIQUE (workspace, building_id, revision),
  FOREIGN KEY (workspace, building_id) REFERENCES blocksignal.properties (workspace, building_id)
);
CREATE INDEX IF NOT EXISTS outbox_due ON blocksignal.outbox (workspace, next_attempt) WHERE delivered_at IS NULL AND cancelled_at IS NULL AND attempts < 5;

CREATE TABLE IF NOT EXISTS blocksignal.health (
  workspace text PRIMARY KEY,
  collector_seen timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION blocksignal.watch_property(p_workspace text, p_id text, p_address text, p_action text)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF p_action NOT IN ('watch', 'pause') OR p_action IS NULL THEN RAISE EXCEPTION 'Invalid watch action'; END IF;
  IF p_action = 'pause' THEN
    UPDATE blocksignal.properties SET active=false, lease_token=NULL, lease_until=NULL
      WHERE workspace=p_workspace AND building_id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Property not registered in this workspace'; END IF;
    UPDATE blocksignal.outbox SET cancelled_at=now(),lease_token=NULL,lease_until=NULL
      WHERE workspace=p_workspace AND building_id=p_id AND delivered_at IS NULL AND cancelled_at IS NULL;
  ELSE
    INSERT INTO blocksignal.properties(workspace,building_id,address) VALUES(p_workspace,p_id,p_address)
    ON CONFLICT(workspace,building_id) DO UPDATE SET address=EXCLUDED.address, active=true,
      next_due=CASE WHEN blocksignal.properties.active THEN blocksignal.properties.next_due ELSE now() END;
  END IF;
  RETURN jsonb_build_object('workspace',p_workspace,'buildingId',p_id,'action',p_action);
END $$;

CREATE OR REPLACE FUNCTION blocksignal.claim_checks(p_workspace text, p_token text)
RETURNS TABLE(workspace text, building_id text, address text, lease_token text)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_token IS NULL OR length(p_token) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid execution token'; END IF;
  INSERT INTO blocksignal.health(workspace,collector_seen) VALUES(p_workspace,now())
    ON CONFLICT ON CONSTRAINT health_pkey DO UPDATE SET collector_seen=EXCLUDED.collector_seen;
  RETURN QUERY
  WITH due AS (
    SELECT p.workspace,p.building_id FROM blocksignal.properties p
    WHERE p.workspace=p_workspace AND p.active AND p.next_due<=now()
      AND (p.lease_until IS NULL OR p.lease_until<now())
    ORDER BY p.next_due,p.building_id LIMIT 10 FOR UPDATE SKIP LOCKED
  )
  UPDATE blocksignal.properties p SET lease_token=p_token,lease_until=now()+interval '30 minutes'
    FROM due d WHERE p.workspace=d.workspace AND p.building_id=d.building_id
    RETURNING p.workspace,p.building_id,p.address,p.lease_token;
END $$;

CREATE OR REPLACE FUNCTION blocksignal.commit_check(p_workspace text,p_id text,p_token text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  p blocksignal.properties%ROWTYPE; snap jsonb; changes jsonb := '[]'::jsonb;
  rec record; before_row jsonb; kind text; priority text; payload jsonb;
  next_revision bigint; failure text;
BEGIN
  SELECT * INTO p FROM blocksignal.properties WHERE workspace=p_workspace AND building_id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT p.active OR p.lease_token IS DISTINCT FROM p_token OR p.lease_until<=now()
    OR p.lease_until IS NULL THEN RAISE EXCEPTION 'Stale or invalid property lease'; END IF;
  IF p_result->>'ok' IS DISTINCT FROM 'true' THEN
    failure := COALESCE(p_result->>'errorCode','invalid_response');
    IF length(failure)>80 THEN failure := 'invalid_response'; END IF;
    IF p.failures+1>=3 AND NOT p.outage_notified THEN
      next_revision := p.revision+1;
      payload := jsonb_build_object('kind','source_unavailable','priority','operational',
        'recordId','source','description','Three consecutive source checks failed. Previous baseline retained.',
        'source','https://hpdonline.nyc.gov/hpdonline/');
      INSERT INTO blocksignal.events(workspace,building_id,revision,record_id,kind,priority,payload)
        VALUES(p_workspace,p_id,next_revision,'source','source_unavailable','operational',payload);
      INSERT INTO blocksignal.outbox(workspace,building_id,revision,payload) VALUES(p_workspace,p_id,next_revision,
        jsonb_build_object('address',p.address,'buildingId',p_id,'observedAt',now(),'changes',jsonb_build_array(payload)));
    ELSE next_revision := p.revision; END IF;
    UPDATE blocksignal.properties SET failures=failures+1,last_error=failure,
      outage_notified=outage_notified OR failures+1>=3,revision=next_revision,
      next_due=now()+interval '90 minutes',lease_token=NULL,lease_until=NULL
      WHERE workspace=p_workspace AND building_id=p_id;
    RETURN jsonb_build_object('accepted',false,'errorCode',failure,'baselineRetained',true);
  END IF;
  -- Revalidate at the persistence boundary, even if the n8n validator is bypassed.
  IF jsonb_typeof(p_result->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid snapshot type'; END IF;
  IF jsonb_array_length(p_result->'rows')>1000 THEN RAISE EXCEPTION 'Snapshot overflow'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_result->'rows') r WHERE
    jsonb_typeof(r) IS DISTINCT FROM 'object' OR COALESCE(r->>'violationid','') !~ '^[0-9]+$'
    OR r->>'buildingid' IS DISTINCT FROM p_id OR r->>'violationstatus' IS DISTINCT FROM 'Open'
    OR COALESCE(r->>'class','') !~ '^[A-Z]{1,8}$') THEN RAISE EXCEPTION 'Invalid snapshot record'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_result->'rows')) <>
    (SELECT count(DISTINCT r->>'violationid') FROM jsonb_array_elements(p_result->'rows') r)
    THEN RAISE EXCEPTION 'Duplicate snapshot record'; END IF;
  SELECT COALESCE(jsonb_object_agg(r->>'violationid',jsonb_build_object(
    'recordId',r->>'violationid','class',r->>'class','status',r->>'currentstatus',
    'statusDate',r->>'currentstatusdate','description',r->>'novdescription')),'{}'::jsonb)
    INTO snap FROM jsonb_array_elements(p_result->'rows') r;
  next_revision := p.revision+1;
  IF p.snapshot IS NOT NULL THEN
    FOR rec IN SELECT key,value FROM jsonb_each(snap) LOOP
      before_row := p.snapshot->rec.key; kind := NULL;
      IF before_row IS NULL THEN kind := 'new_open_record';
      ELSIF rec.value->'class' IS DISTINCT FROM before_row->'class'
        OR rec.value->'status' IS DISTINCT FROM before_row->'status'
        OR rec.value->'statusDate' IS DISTINCT FROM before_row->'statusDate' THEN kind := 'status_changed'; END IF;
      IF kind IS NOT NULL THEN
        priority := CASE WHEN rec.value->>'class'='C' THEN 'urgent_review' ELSE 'review' END;
        changes := changes || jsonb_build_array(rec.value || jsonb_build_object('kind',kind,'priority',priority,
          'previousStatus',before_row->>'status','source','https://hpdonline.nyc.gov/hpdonline/'));
      END IF;
    END LOOP;
    FOR rec IN SELECT key,value FROM jsonb_each(p.snapshot) LOOP
      IF NOT snap ? rec.key THEN
        changes := changes || jsonb_build_array(rec.value || jsonb_build_object('kind','no_longer_open',
          'priority','verify','description','No longer returned as open. Verify with HPD; this does not establish a completed repair.',
          'source','https://hpdonline.nyc.gov/hpdonline/'));
      END IF;
    END LOOP;
  END IF;
  IF p.outage_notified THEN
    changes := changes || jsonb_build_array(jsonb_build_object('recordId','source','kind','source_recovered',
      'priority','operational','description','Source checks recovered. Changes cover the gap since the last successful snapshot.',
      'source','https://hpdonline.nyc.gov/hpdonline/'));
  END IF;
  FOR rec IN SELECT value FROM jsonb_array_elements(changes) LOOP
    INSERT INTO blocksignal.events(workspace,building_id,revision,record_id,kind,priority,payload)
      VALUES(p_workspace,p_id,next_revision,rec.value->>'recordId',rec.value->>'kind',rec.value->>'priority',rec.value);
  END LOOP;
  IF jsonb_array_length(changes)>0 THEN
    INSERT INTO blocksignal.outbox(workspace,building_id,revision,payload) VALUES(p_workspace,p_id,next_revision,
      jsonb_build_object('address',p.address,'buildingId',p_id,'observedAt',now(),'changes',changes));
  END IF;
  UPDATE blocksignal.properties SET snapshot=snap,revision=next_revision,last_checked=now(),failures=0,
    last_error=NULL,outage_notified=false,next_due=now()+interval '24 hours',lease_token=NULL,lease_until=NULL
    WHERE workspace=p_workspace AND building_id=p_id;
  RETURN jsonb_build_object('accepted',true,'baseline',p.snapshot IS NULL,'changes',jsonb_array_length(changes));
END $$;

CREATE OR REPLACE FUNCTION blocksignal.claim_notices(p_workspace text,p_token text)
RETURNS SETOF blocksignal.outbox LANGUAGE plpgsql AS $$
BEGIN
  IF p_token IS NULL OR length(p_token) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Invalid execution token'; END IF;
  RETURN QUERY
  WITH due AS (
    SELECT o.id FROM blocksignal.outbox o WHERE o.workspace=p_workspace AND o.delivered_at IS NULL AND o.cancelled_at IS NULL
      AND o.attempts<5 AND o.next_attempt<=now() AND (o.lease_until IS NULL OR o.lease_until<now())
    ORDER BY o.next_attempt,o.id LIMIT 10 FOR UPDATE SKIP LOCKED
  )
  UPDATE blocksignal.outbox o SET lease_token=p_token,lease_until=now()+interval '10 minutes',attempts=o.attempts+1
    FROM due d WHERE o.id=d.id RETURNING o.*;
END $$;

CREATE OR REPLACE FUNCTION blocksignal.finish_notice(p_workspace text,p_id bigint,p_token text,p_sent boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o blocksignal.outbox%ROWTYPE;
BEGIN
  SELECT * INTO o FROM blocksignal.outbox WHERE workspace=p_workspace AND id=p_id FOR UPDATE;
  IF NOT FOUND OR o.lease_token IS DISTINCT FROM p_token OR o.lease_until<=now() OR o.lease_until IS NULL
    THEN RAISE EXCEPTION 'Stale or invalid notice lease'; END IF;
  UPDATE blocksignal.outbox SET delivered_at=CASE WHEN p_sent THEN now() ELSE NULL END,
    next_attempt=now()+make_interval(mins => CASE o.attempts WHEN 1 THEN 2 WHEN 2 THEN 10 WHEN 3 THEN 30 WHEN 4 THEN 120 ELSE 360 END),
    last_error=CASE WHEN p_sent THEN NULL ELSE 'delivery_failed' END,lease_token=NULL,lease_until=NULL
    WHERE workspace=p_workspace AND id=p_id;
  RETURN jsonb_build_object('noticeId',p_id,'delivered',p_sent,'attempts',o.attempts,'exhausted',NOT p_sent AND o.attempts>=5);
END $$;

CREATE OR REPLACE FUNCTION blocksignal.health_report(p_workspace text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'workspace',p_workspace,
    'collectorStale',EXISTS(SELECT 1 FROM blocksignal.properties p WHERE p.workspace=p_workspace AND p.active
      AND p.created_at<now()-interval '2 hours') AND NOT EXISTS(SELECT 1 FROM blocksignal.health h
      WHERE h.workspace=p_workspace AND h.collector_seen>=now()-interval '2 hours'),
    'sourceFailures',(SELECT count(*) FROM blocksignal.properties WHERE workspace=p_workspace AND active AND failures>=3),
    'overdueChecks',(SELECT count(*) FROM blocksignal.properties WHERE workspace=p_workspace AND active AND next_due<now()-interval '2 hours'),
    'exhaustedNotices',(SELECT count(*) FROM blocksignal.outbox WHERE workspace=p_workspace AND delivered_at IS NULL AND cancelled_at IS NULL AND attempts>=5
      AND (lease_until IS NULL OR lease_until<now())),
    'oldPendingNotices',(SELECT count(*) FROM blocksignal.outbox WHERE workspace=p_workspace AND delivered_at IS NULL AND cancelled_at IS NULL AND created_at<now()-interval '2 hours')
  );
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA blocksignal FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA blocksignal FROM PUBLIC;
-- Grant the dedicated n8n role USAGE on this schema, SELECT/INSERT/UPDATE on these
-- four tables, USAGE/SELECT on its identity sequences and EXECUTE on these functions.
-- No DROP, DELETE, superuser access or direct public-browser database credentials.
