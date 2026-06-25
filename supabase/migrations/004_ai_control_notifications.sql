-- Notiser och aktivitet när externa AI-klienter skapar uppgifter via MCP.
-- Kör efter 003_context_links_ai_agent.sql.

create or replace function public.orbit_task_created_activity() returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.activity_log(task_id,actor_id,action,details)
  values(
    new.id,
    new.created_by,
    'created',
    jsonb_build_object(
      'assignee_id', new.assignee_id,
      'project_id', new.project_id,
      'bucket', new.bucket,
      'source', 'orbit'
    )
  );

  if new.assignee_id is not null and new.assignee_id<>new.created_by then
    insert into public.notifications(user_id,task_id,type,title,body)
    values(new.assignee_id,new.id,'assignment','Ny uppgift tilldelad',new.title);
  end if;

  return new;
end $$;

drop trigger if exists orbit_task_created_activity_trigger on public.tasks;
create trigger orbit_task_created_activity_trigger
after insert on public.tasks
for each row execute function public.orbit_task_created_activity();
