# Spec: toast-close-button

## Acceptance Criteria
1. Each toast notification has a small (x) button in the top-right corner
2. Clicking the button dismisses the toast immediately
3. Existing swipe-to-dismiss behavior is preserved
4. The button is visually subtle (muted color) but becomes more visible on hover
5. `bun run typecheck` passes

## Out of Scope
- Changing toast positioning or animation
- Adding auto-dismiss timers

## Plan
1. Find the toast component in `apps/web/src/components/ui/toast.tsx`
2. Add a close button using the existing dismiss mechanism
3. Style it to be unobtrusive but accessible
