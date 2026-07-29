# Exploration: toast-close-button

## Relevant Files
- `apps/web/src/components/ui/toast.tsx` — main toast component, lines 312-366 render each toast's `Toast.Root` > `Toast.Content`

## Key Findings
- `@base-ui/react/toast` exports `Toast.Close` — a built-in close button component
- The close button should go inside `Toast.Root`, after `Toast.Content`
- Uses `XIcon` from lucide-react (already imported elsewhere in the project)
- Position: absolute top-right corner of the toast card
- The `toastManager.close(toast.id)` can also be called programmatically

## Insertion Point
- Inside the `Toast.Root` component (line 312), after the `Toast.Content` block (line 365)
- Or as a sibling inside `Toast.Content` with absolute positioning
