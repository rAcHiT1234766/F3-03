# Individual reflection (to be written by the intern)

Spec §27: the intern provides the personal facts. This file holds the questions plus project facts
that can help, but no invented experiences. Replace each prompt with your own answer.

## Facts you can draw on (from the repository)

- Work was done with an AI coding assistant from the specification `FE-03-Codex-Project-Workflow.md`.
  Its decisions, defects and test results are in `docs/decisions.md`, `docs/progress.md` and
  `docs/test-matrix.md`.
- Defects found by tests: the resolver could copy unknown patch keys; contention surfaced as
  `permission-denied`; the update reload did not fire on a page first loaded uncontrolled; the
  "ready offline" notice caused a layout shift and then covered the Save button; status messages
  were announced twice to screen readers.
- Not yet verified: real Firebase project, deployment, installation, real push, Firefox/Safari.

## Questions

1. Which screens, persistence functions, sync behaviors, tests and deployment tasks did I own?
   _Your answer._
2. What did I initially misunderstand about service workers versus IndexedDB?
   _Your answer._
3. Why did I choose a custom durable outbox instead of relying only on Firebase offline persistence?
   _Your answer._
4. What is the difference between at-least-once delivery and idempotent state changes?
   _Your answer._
5. Which conflict policy did I implement, and what does it still not solve?
   _Your answer._
6. Which failure case forced a change in my design?
   _Your answer._
7. What did the browser/device tests reveal that unit tests did not?
   _Your answer._
8. How did I use the AI assistant, and how did I verify the code it produced?
   _Your answer. For example: which tests you read or ran yourself, which changes you reviewed,
   and what you checked by hand._
9. Which optional feature did I intentionally leave out to keep the required project reliable?
   _Your answer._
10. What would I change before using this application for a real field-service team?
    _Your answer._
