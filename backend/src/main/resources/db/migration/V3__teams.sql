create table teams (
    id uuid primary key,
    name varchar(200) not null,
    owner_id uuid not null references users (id) on delete cascade,
    created_at timestamp with time zone not null default now(),
    constraint teams_name_not_blank_check check (length(btrim(name)) > 0)
);

create index teams_owner_idx on teams (owner_id);

create table team_members (
    team_id uuid not null references teams (id) on delete cascade,
    user_id uuid not null references users (id) on delete cascade,
    role varchar(16) not null,
    created_at timestamp with time zone not null default now(),
    primary key (team_id, user_id),
    constraint team_members_role_check check (role in ('owner', 'member'))
);

create index team_members_user_idx on team_members (user_id);
