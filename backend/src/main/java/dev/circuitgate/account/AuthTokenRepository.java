package dev.circuitgate.account;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuthTokenRepository extends JpaRepository<AuthToken, Long> {

	Optional<AuthToken> findByTokenHash(String tokenHash);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("""
			update AuthToken t
			set t.consumedAt = :now
			where t.tokenHash = :hash
			  and t.type = :type
			  and t.consumedAt is null
			  and t.expiresAt > :now
			""")
	int consumeByHash(@Param("hash") String hash, @Param("type") TokenType type, @Param("now") Instant now);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("""
			update AuthToken t
			set t.consumedAt = :now
			where t.user.id = :userId
			  and t.type = :type
			  and t.consumedAt is null
			""")
	int consumeAllForUser(@Param("userId") UUID userId, @Param("type") TokenType type, @Param("now") Instant now);

	@Modifying(clearAutomatically = true, flushAutomatically = true)
	@Query("""
			update AuthToken t
			set t.consumedAt = :now
			where t.user.id = :userId
			  and t.consumedAt is null
			""")
	int consumeAllForUser(@Param("userId") UUID userId, @Param("now") Instant now);

	@Modifying
	@Query("delete from AuthToken t where t.expiresAt < :now or (t.consumedAt is not null and t.consumedAt < :cutoff)")
	int deleteStale(@Param("now") Instant now, @Param("cutoff") Instant cutoff);
}
