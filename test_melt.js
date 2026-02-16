
function cloneWithDescriptors(obj) {
  const proto = Object.getPrototypeOf(obj);
  const clone = Object.create(proto);
  Object.defineProperties(clone, Object.getOwnPropertyDescriptors(obj));
  return clone;
}

function meltFrozenObject(frozenObj) {
  return cloneWithDescriptors(frozenObj);
}

const obj = { prop: 'value' };
Object.freeze(obj);

console.log('Original writable:', Object.getOwnPropertyDescriptor(obj, 'prop').writable);

const melted = meltFrozenObject(obj);
console.log('Melted writable:', Object.getOwnPropertyDescriptor(melted, 'prop').writable);

try {
    melted.prop = 'newValue';
} catch (e) {
    console.log('Error modifying melted prop:', e.message);
}

console.log('Melted prop value:', melted.prop);
