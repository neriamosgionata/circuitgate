# syntax=docker/dockerfile:1
FROM maven:3.9-eclipse-temurin-25 AS build

WORKDIR /build

COPY pom.xml ./
RUN mvn --batch-mode --no-transfer-progress dependency:go-offline

COPY src ./src
RUN mvn --batch-mode --no-transfer-progress -DskipTests package

FROM eclipse-temurin:25-jre-alpine AS runtime

RUN addgroup -S circuitgate && adduser -S circuitgate -G circuitgate

WORKDIR /app

COPY --from=build /build/target/circuitgate-backend-*.jar app.jar

USER circuitgate

EXPOSE 8080

ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
