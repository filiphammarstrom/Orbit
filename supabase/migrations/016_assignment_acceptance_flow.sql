-- Assignment inbox decisions: assignees can accept or decline assigned work,
-- and creators get notified about the response.

alter table public.tasks
  add column if not exists assignment_status text not null default 'accepted'
    check (assignment_status in ('accepted','pending','declined')),
  add column if not exists assignment_responded_at timestamptz,
  add column if not exists assignment_response_note text not null default '';

update public.tasks
set assignment_status = 'accepted'
where assignment_status is null;

create or replace function public.orbit_prepare_assignment_state()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    if new.assignee_id is not null and new.assignee_id is distinct from new.created_by then
      new.assignment_status := 'pending';
      new.assignment_responded_at := null;
      new.assignment_response_note := '';
    else
      new.assignment_status := 'accepted';
      new.assignment_responded_at := null;
      new.assignment_response_note := '';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orbit_prepare_assignment_state_trigger on public.tasks;
create trigger orbit_prepare_assignment_state_trigger
before insert or update of assignee_id
on public.tasks
for each row execute function public.orbit_prepare_assignment_state();

create or replace function public.orbit_task_activity()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  action_name text;
begin
  if new.completed and not old.completed then
    perform public.evaluate_task_dependencies(new.id);
  end if;

  action_name := case
    when new.completed and not old.completed then 'completed'
    when new.assignment_status is distinct from old.assignment_status and new.assignment_status='accepted' then 'assignment_accepted'
    when new.assignment_status is distinct from old.assignment_status and new.assignment_status='declined' then 'assignment_declined'
    when new.assignee_id is distinct from old.assignee_id then 'assigned'
    when new.status is distinct from old.status then 'status_changed'
    else 'updated'
  end;

  insert into public.activity_log(task_id,actor_id,action,details)
  values(
    new.id,
    (select auth.uid()),
    action_name,
    jsonb_build_object(
      'from_status', old.status,
      'to_status', new.status,
      'from_assignment_status', old.assignment_status,
      'to_assignment_status', new.assignment_status,
      'assignment_response_note', new.assignment_response_note
    )
  );

  if new.assignee_id is distinct from old.assignee_id
    and new.assignee_id is not null
    and new.assignee_id <> coalesce((select auth.uid()), new.created_by)
  then
    insert into public.notifications(user_id,task_id,type,title,body)
    values(new.assignee_id,new.id,'assignment','Ny uppgift tilldelad',new.title || ' · svara i Inbox');
  end if;

  if new.assignment_status is distinct from old.assignment_status
    and new.assignment_status in ('accepted','declined')
    and new.created_by is not null
    and new.created_by is distinct from new.assignee_id
  then
    insert into public.notifications(user_id,task_id,type,title,body)
    values(
      new.created_by,
      new.id,
      'assignment_response',
      case when new.assignment_status='accepted' then 'Uppgift accepterad' else 'Uppgift nekad' end,
      new.title || coalesce(' · ' || nullif(new.assignment_response_note,''),'')
    );
  end if;

  return new;
end $$;

drop trigger if exists orbit_task_activity_trigger on public.tasks;
create trigger orbit_task_activity_trigger
after update on public.tasks
for each row execute function public.orbit_task_activity();

do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null;
end $$;
