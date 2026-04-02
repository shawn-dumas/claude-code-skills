// Fixture: arrow functions in various positions to test getFunctionName paths

// Arrow as class property declaration (parent = PropertyDeclaration)
// This exercises the Node.isPropertyDeclaration(parent) branch in getFunctionName
export class UserController {
  fetchUser = (userId: string): unknown => {
    return { id: userId };
  };
}

// Arrow function in an object literal (parent is NOT VariableDeclaration or PropertyDeclaration)
// This exercises the '<arrow>' fallback path in getFunctionName
export const handlers = {
  getUser: (userId: string): unknown => {
    return { id: userId };
  },
};
