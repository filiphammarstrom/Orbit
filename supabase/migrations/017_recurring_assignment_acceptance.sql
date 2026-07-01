-- Keep recurring assigned tasks accepted when the next occurrence is generated.
-- Otherwise an already accepted recurring task would reappear in the assignee's
-- inbox as a new pending assignment every time it repeats.

create or replace function public.orbit_prepare_assignment_state()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    if tg_op = 'INSERT' and new.assignment_responded_at is not null then
      return new;
    end if;

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

create or replace function public.orbit_recreate_recurring_task()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  next_due_at timestamptz;
  next_reminder_at timestamptz;
  step interval;
begin
  if new.completed and not old.completed and new.recurrence_rule in ('daily','weekly','monthly') then
    step := case new.recurrence_rule
      when 'daily' then interval '1 day'
      when 'weekly' then interval '1 week'
      when 'monthly' then interval '1 month'
      else interval '0'
    end;

    next_due_at := case when new.due_at is not null then new.due_at + step else null end;
    next_reminder_at := case when new.reminder_at is not null then new.reminder_at + step else null end;

    insert into public.tasks(
      project_id, created_by, assignee_id, parent_task_id, title, notes,
      bucket, priority, due_text, due_at, reminder_at, status, task_type,
      recurrence_rule, visible, assignment_status, assignment_responded_at,
      assignment_response_note
    )
    values(
      new.project_id, new.created_by, new.assignee_id, new.parent_task_id,
      new.title, new.notes, new.bucket, new.priority, new.due_text,
      next_due_at, next_reminder_at, 'todo', new.task_type,
      new.recurrence_rule, true, 'accepted', now(),
      'Automatiskt skapad återkommande uppgift.'
    );
  end if;
  return new;
end $$;
