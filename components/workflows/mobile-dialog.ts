/**
 * What a dialog and a drawer look like on a phone.
 *
 * `components/ui/dialog.tsx` centres its popup with `top-1/2 left-1/2` and a pair of translates,
 * and caps it at `calc(100% - 2rem)`; `sheet.tsx` gives its right-hand drawer `w-3/4`. Both are
 * right on a laptop and wrong on a 390px screen, where a template gallery in a 358px box clips and
 * a run drawer in 292px is a column of ellipses.
 *
 * So rather than each dialog inventing its own set of overrides, the two shapes live here: the
 * popup is pinned to the top-left corner and grown to the viewport, and the drawer is grown to the
 * full width. Nothing about the desktop layout is touched — every class is behind `max-sm`.
 *
 * (It lives under `workflows/` only because that is a directory this feature owns; `components/ui`
 * and `components/shared` are shared primitives.)
 */

/**
 * A dialog that fills a phone.
 *
 * Every class here beats an unprefixed one from `DialogContent`, so plain `max-sm:` is enough —
 * the translates are zeroed rather than fought with `inset-0`, which would depend on shorthand
 * ordering against `top-1/2`.
 *
 * The caller supplies the grid rows, because only the caller knows how many children it has: pair
 * this with `max-sm:grid-rows-[auto_minmax(0,1fr)]` for header-plus-body, so the *body* scrolls and
 * the close button — absolutely positioned on the popup — stays where a thumb left it.
 *
 * The caller must also put `min-w-0` on each of those children. A grid item's automatic minimum
 * size is its *min-content* width, and an `overflow-x-auto` strip does not zero that — so without
 * it a row of category chips silently widens the popup's one column to 1100px and everything in
 * the dialog is laid out off the side of the screen. `grid-cols-[minmax(0,1fr)]` here pins the
 * track; `min-w-0` there is what lets the item sit inside it.
 */
export const FULL_SCREEN_DIALOG =
  "max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:grid-cols-[minmax(0,1fr)]";

/**
 * A dialog that keeps its height but takes the whole width — for the short ones (rename, confirm)
 * where a full-screen sheet for a single field would be theatre.
 *
 * `max-w-none!` because the alert dialog's own cap is itself behind a variant
 * (`data-[size=default]:max-w-xs`), and two variants have no guaranteed order between them.
 */
export const FULL_WIDTH_DIALOG =
  "max-sm:left-0 max-sm:max-w-none! max-sm:translate-x-0 max-sm:rounded-none";

/**
 * A right-hand drawer that takes the whole width of a phone.
 *
 * `w-full!` for the same reason: the width it replaces is `data-[side=right]:w-3/4`.
 */
export const FULL_WIDTH_SHEET = "max-sm:w-full!";
