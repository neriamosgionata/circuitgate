create table users (
    id uuid primary key,
    email varchar(320) not null,
    password_hash varchar(100) not null,
    email_verified boolean not null default false,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create unique index users_email_unique_idx on users (lower(email));

create table auth_tokens (
    id bigint generated always as identity primary key,
    user_id uuid not null references users (id) on delete cascade,
    type varchar(32) not null,
    token_hash varchar(64) not null,
    created_at timestamp with time zone not null default now(),
    expires_at timestamp with time zone not null,
    consumed_at timestamp with time zone
);

create unique index auth_tokens_token_hash_key on auth_tokens (token_hash);

create index auth_tokens_user_type_idx on auth_tokens (user_id, type);

create table throttle_counters (
    scope varchar(16) not null,
    action varchar(32) not null,
    subject varchar(320) not null,
    failures integer not null,
    window_start timestamp with time zone not null default now(),
    blocked_until timestamp with time zone,
    updated_at timestamp with time zone not null default now(),
    primary key (scope, action, subject)
);

create table persistent_logins (
    series varchar(64) primary key,
    username varchar(320) not null,
    token varchar(64) not null,
    last_used timestamp with time zone not null
);

create index persistent_logins_username_idx on persistent_logins (username);

create table spring_session (
    primary_id char(36) not null,
    session_id char(36) not null,
    creation_time bigint not null,
    last_access_time bigint not null,
    max_inactive_interval integer not null,
    expiry_time bigint not null,
    principal_name varchar(100),
    constraint spring_session_pk primary key (primary_id)
);

create unique index spring_session_ix1 on spring_session (session_id);

create index spring_session_ix2 on spring_session (expiry_time);

create index spring_session_ix3 on spring_session (principal_name);

create table spring_session_attributes (
    session_primary_id char(36) not null,
    attribute_name varchar(200) not null,
    attribute_bytes bytea not null,
    constraint spring_session_attributes_pk primary key (session_primary_id, attribute_name),
    constraint spring_session_attributes_fk foreign key (session_primary_id)
        references spring_session (primary_id) on delete cascade
);
