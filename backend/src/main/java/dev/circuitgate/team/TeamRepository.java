package dev.circuitgate.team;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface TeamRepository extends JpaRepository<Team, UUID> {
}
