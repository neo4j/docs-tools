#!/bin/bash

TEST_ADOC=vale/test.adoc
TEST_RESULTS=vale/test-results.txt

vale --config vale/.vale.ini --output line ${TEST_ADOC} > ${TEST_RESULTS}

if ! git diff --quiet ${TEST_RESULTS};
  then
    echo "Vale test results changed"
    exit 1
fi