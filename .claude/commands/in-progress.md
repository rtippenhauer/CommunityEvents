Call `GET /api/v1/admin/feedback/in-progress` to retrieve all feedback items currently marked in_progress.

Display the results as a numbered list with: ID, category (bug/feature/comment), title or body preview (truncated to ~80 chars), upvote count, and how long it's been in progress (from updatedAt).

Then ask Rob which items (by ID) are related to the current phase of work. For each one he identifies, add an admin note via `POST /api/v1/admin/feedback/:id/notes` with the body: "Tracked in Phase $ARGUMENTS." so there's a record linking the item to the phase.

If $ARGUMENTS is empty, just present the list without adding notes.
