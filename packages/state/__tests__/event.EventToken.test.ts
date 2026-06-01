import { describe, it, expect } from 'vitest';
import { EventToken, isEventToken } from '../src/event/EventToken';
import { CommandToken } from '../src/command/CommandToken';
import { Token } from '../src/token/Token';

describe('EventToken', () => {
  it('Tokenを継承したpub/subであること', () => {
    const token = new EventToken('userCreated');
    expect(token).toBeInstanceOf(Token);
    expect(token.name).toBe('userCreated');
    const results = token.emit('a');
    expect(results).toEqual([]);
  });

  it('isEventTokenはEventTokenのみtrueを返すこと', () => {
    expect(isEventToken(new EventToken('x'))).toBe(true);
    expect(isEventToken(new CommandToken('x'))).toBe(false);
    expect(isEventToken(new Token('x'))).toBe(false);
    expect(isEventToken('x')).toBe(false);
    expect(isEventToken(null)).toBe(false);
  });
});
