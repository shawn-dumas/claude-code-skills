/* eslint-disable */
// Fixture for side-effect classifier null-return paths.

// Unknown object.method call -- not in PROPERTY_ACCESS_MAP, not posthog.people.set.
// classifyPropertyAccess returns null for this.
function unknownCalls() {
  someService.doSomething('arg');
  router.push('/path');
}

// Non-identifier, non-property-access call expression (dynamic call).
// classifyCallExpression returns null when callee is neither identifier nor property access.
const handlers = [() => {}];
handlers[0]();
