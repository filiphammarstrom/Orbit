-- Improve recurring tasks so the next generated task keeps a useful next date.
-- Run after 002_project_management.sql.

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
      recurrence_rule, visible
    )
    values(
      new.project_id, new.created_by, new.assignee_id, new.parent_task_id,
      new.title, new.notes, new.bucket, new.priority, new.due_text,
      next_due_at, next_reminder_at, 'todo', new.task_type,
      new.recurrence_rule, true
    );
  end if;
  return new;
end $$;

drop trigger if exists orbit_recurring_task_trigger on public.tasks;
create trigger orbit_recurring_task_trigger
after update of completed on public.tasks
for each row execute function public.orbit_recreate_recurring_task();

