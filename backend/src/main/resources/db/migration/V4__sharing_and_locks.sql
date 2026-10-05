create table project_teams (
    project_id uuid not null references projects (id) on delete cascade,
    team_id uuid not null references teams (id) on delete cascade,
    created_by uuid not null references users (id) on delete cascade,
    created_at timestamp with time zone not null default now(),
    primary key (project_id, team_id)
);

create index project_teams_team_idx on project_teams (team_id);

create table project_locks (
    project_id uuid primary key references projects (id) on delete cascade,
    holder_id uuid not null references users (id) on delete cascade,
    epoch bigint not null default 1,
    acquired_at timestamp with time zone not null default now(),
    expires_at timestamp with time zone not null,
    released_at timestamp with time zone,
    constraint project_locks_epoch_check check (epoch >= 1)
);

create index project_locks_holder_idx on project_locks (holder_id);
