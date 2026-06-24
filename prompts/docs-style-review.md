You are reviewing a documentation pull request for adherence to the
**Neo4j documentation style guide**. This review is ADVISORY and must never
block the PR.

Review ONLY the changed AsciiDoc pages and partials listed under "Context"
above, and focus on the ADDED or CHANGED lines (use the `git diff` command
shown there). Do not comment on pre-existing text outside the diff.

Ignore AsciiDoc comments — single-line comments starting with `//` and block
comments delimited by `////`. They are not published, so do not review or flag
their content even when they appear in the diff.

## Reference: the style guide
Fetch the consolidated style guide from the URL given under "Context" above —
it is a single file containing the entire style guide. Use it as your reference,
and do not fetch anything else.

If that URL is unreachable, say so briefly in your review and fall back to
general technical-writing best practice.

## What to check
Tone and voice, writing style, terminology consistency, list/heading
conventions, inclusive language, punctuation, and formatting of
admonitions/code/labels.

## Output
Write your review as a single Markdown document to the file
`style-review-comment.md` in the current working directory, using the Write
tool. Do NOT post a comment or run any git/gh commands — a later workflow step
publishes that file as a sticky PR comment.

Group findings by file. For each finding, quote the relevant snippet, explain
the issue, and cite the specific style-guide page it relates to. Be concise.
Prioritise judgement-based style issues — that is the main value. There is no separate
linter in production, so ALSO flag clear mechanical errors (typos, misspellings, obviously
wrong words); just don't nitpick every stylistic word choice.

If you suggest a rewrite, make sure the rewrite itself complies with the style
guide — in particular, address the user in the second person, do not use "we"
to refer to Neo4j, and prefer active voice.

Report at most the 10 most important findings, and keep the whole document
under ~400 words. If there are more issues, say so briefly rather than listing
them all.

Begin the document by stating this is an automated, advisory style-guide
review. If you find nothing noteworthy, still write the file with a one-line
"no notable style issues found" message.
