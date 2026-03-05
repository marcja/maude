#!/usr/bin/env bash
set -e

pnpm type-check
pnpm lint
pnpm test --passWithNoTests
pnpm test:coverage --passWithNoTests
echo "✓ Pre-commit gate passed"
