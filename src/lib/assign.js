import { supabase } from "./supabase";

export async function jobCallingSummary(jobId, batchId) {
  const { data, error } = await supabase.rpc("job_calling_summary", { p_job_id: jobId, p_batch_id: batchId || null });
  if (error) throw error;
  return data;
}
export async function assignJobCalling(jobId, callerIds, scope, batchId) {
  const { data, error } = await supabase.rpc("assign_job_calling", {
    p_job_id: jobId, p_caller_ids: callerIds, p_scope: scope, p_batch_id: batchId || null,
  });
  if (error) throw error;
  return data;
}
