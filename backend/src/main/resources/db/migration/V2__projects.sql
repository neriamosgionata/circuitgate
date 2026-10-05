create table projects (
    id uuid primary key,
    owner_id uuid not null references users (id) on delete cascade,
    name varchar(200) not null,
    document jsonb not null,
    schema_version integer not null,
    content_version bigint not null default 1,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint projects_content_version_check check (content_version >= 1),
    constraint projects_document_size_check check (octet_length(document::text) <= 4194304)
);

create index projects_owner_updated_idx on projects (owner_id, updated_at desc);
