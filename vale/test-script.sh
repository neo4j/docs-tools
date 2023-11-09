#!/bin/bash

TEST_ADOC=test.adoc
TEST_RESULTS=test-results.txt

vale --output line ${TEST_ADOC} > ${TEST_RESULTS}

if ! git diff --quiet ${TEST_RESULTS}
then
  echo "Vale test results changed"
  exit 1
fi