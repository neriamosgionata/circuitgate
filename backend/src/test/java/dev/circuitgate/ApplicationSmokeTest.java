package dev.circuitgate;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ApplicationSmokeTest {

	@Autowired
	private DataSource dataSource;

	@Test
	void contextLoads() {
	}

	@Test
	void connectsToPostgreSql() throws Exception {
		try (Connection connection = dataSource.getConnection();
				Statement statement = connection.createStatement();
				ResultSet result = statement.executeQuery("select version()")) {
			assertTrue(result.next());
			assertTrue(result.getString(1).contains("PostgreSQL"));
		}
	}
}
