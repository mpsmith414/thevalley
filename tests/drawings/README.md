# Drawing test set

Every image here runs through the creature designer on the **Drawing test set** page
(`npm run dev`, then open http://localhost:5180/drawings.html and press **Run all**).

- The four `.png` files are synthetic crayon drawings made by `npx tsx tools/make-test-drawings.ts`.
- **Add real drawings:** take a photo of a drawing (flat, good light, the whole page in frame)
  and drop it here as a `.jpg`. Reload the page and it appears as a new row.

## Scoring

Score each creature on the page (it remembers your scores in this browser):

| Score | Meaning |
|---|---|
| 1 😕 | "That's not mine" |
| 2 🙂 | "Kind of" |
| 3 🤩 | "That's MY one!" |

The Creature Lab is working when most real drawings score 3.
