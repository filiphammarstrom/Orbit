update public.areas
set name = 'Allmänt'
where name = 'Privat'
  and category = 'Privat';

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,name,initials)
  values(new.id,coalesce(new.raw_user_meta_data->>'name',split_part(new.email,'@',1)),upper(left(coalesce(new.raw_user_meta_data->>'name',new.email),2)))
  on conflict (id) do nothing;
  insert into public.areas(name,icon,color,category,owner_id) values('Allmänt','⌂','#49a58f','Privat',new.id);
  insert into public.team_members(team_id,user_id,role,status)
  select i.team_id,new.id,i.role,'active' from public.invitations i
  where lower(i.email)=lower(new.email) and i.accepted_at is null and i.expires_at>now()
  on conflict (team_id,user_id) do update set role=excluded.role,status='active';
  update public.invitations i set accepted_at=now()
  where lower(i.email)=lower(new.email) and i.accepted_at is null and i.expires_at>now();
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
