
function cloneWithDescriptors(obj: object) {
  const proto = Object.getPrototypeOf(obj);
  const clone = Object.create(proto);
  Object.defineProperties(clone, Object.getOwnPropertyDescriptors(obj));
  return clone;
}

export function meltFrozenObject(frozenObj: object) {
  return cloneWithDescriptors(frozenObj);
}