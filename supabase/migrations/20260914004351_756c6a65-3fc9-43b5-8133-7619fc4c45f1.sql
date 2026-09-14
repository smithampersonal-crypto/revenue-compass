ALTER TABLE public.document_upload_intents
  ADD COLUMN IF NOT EXISTS declared_byte_size bigint,
  ADD COLUMN IF NOT EXISTS read_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_diagnostics jsonb;

ALTER TABLE public.document_upload_intents
  ADD CONSTRAINT document_upload_intents_declared_byte_size_check
  CHECK (declared_byte_size IS NULL OR (declared_byte_size > 0 AND declared_byte_size <= 10485760));

COMMENT ON COLUMN public.document_upload_intents.declared_byte_size IS
  'Transport-integrity expectation taken from the browser-selected file size. Never a validated document fact: the server-downloaded bytes remain authoritative for sha256, byte size, page count and validity.';
COMMENT ON COLUMN public.document_upload_intents.upload_diagnostics IS
  'Private per-read-attempt technical diagnostics (declared size, observed size, server sha256, pdf signature presence, validation code). Never PDF text or raw bytes.';