import { TWS_BINDING_MAX_LOCATORS, type TwsLocator } from "@t3tools/contracts";

export type TwsBindingMatch<Id extends string> =
  | { readonly kind: "new" }
  | { readonly kind: "matched"; readonly id: Id }
  | { readonly kind: "ambiguous"; readonly ids: ReadonlyArray<Id> };

function locatorKey(locator: TwsLocator): string {
  return `${locator.kind}\0${locator.value}`;
}

export function mergeTwsLocators(
  canonicalLocator: TwsLocator,
  ...collections: ReadonlyArray<ReadonlyArray<TwsLocator>>
): ReadonlyArray<TwsLocator> {
  const merged = new Map<string, TwsLocator>();
  merged.set(locatorKey(canonicalLocator), canonicalLocator);
  for (const locators of collections) {
    for (const locator of locators) {
      const key = locatorKey(locator);
      if (!merged.has(key)) {
        merged.set(key, locator);
      }
    }
  }
  return [...merged.values()].slice(0, TWS_BINDING_MAX_LOCATORS);
}

export function matchTwsBindingByLocators<Id extends string>(
  bindings: ReadonlyArray<{
    readonly id: Id;
    readonly canonicalLocator: TwsLocator;
    readonly locators: ReadonlyArray<TwsLocator>;
  }>,
  observedLocators: ReadonlyArray<TwsLocator>,
): TwsBindingMatch<Id> {
  const observed = new Set(observedLocators.map(locatorKey));
  const ids = [
    ...new Set(
      bindings.flatMap((binding) =>
        [binding.canonicalLocator, ...binding.locators].some((locator) =>
          observed.has(locatorKey(locator)),
        )
          ? [binding.id]
          : [],
      ),
    ),
  ].toSorted();

  if (ids.length === 0) {
    return { kind: "new" };
  }
  if (ids.length === 1) {
    return { kind: "matched", id: ids[0]! };
  }
  return { kind: "ambiguous", ids };
}
