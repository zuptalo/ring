.PHONY: run test vet fmt tidy db-up db-down

run:        ## Start the server (applies migrations + dev seed on boot)
	go run ./cmd/ringd

test:       ## Run all tests (no database required)
	go test ./...

vet:        ## Static checks
	go vet ./...

fmt:        ## Format the codebase
	gofmt -w .

tidy:       ## Resolve and prune go.mod/go.sum
	go mod tidy

db-up:      ## Start local PostgreSQL 18 (Docker)
	docker compose up -d

db-down:    ## Stop local PostgreSQL (keeps the data volume)
	docker compose down
