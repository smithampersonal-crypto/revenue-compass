CREATE UNIQUE INDEX IF NOT EXISTS storage_deletion_queue_bucket_path_key
  ON public.storage_deletion_queue (storage_bucket, storage_object_path);