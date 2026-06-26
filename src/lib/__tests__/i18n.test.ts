import { interpolate } from '../i18n';

describe('interpolate', () => {
  test('returns string unchanged when no vars', () => {
    expect(interpolate('Hello world')).toBe('Hello world');
  });

  test('returns string unchanged when vars is undefined', () => {
    expect(interpolate('Hello {name}')).toBe('Hello {name}');
  });

  test('replaces a single variable', () => {
    expect(interpolate('Hello {name}', { name: 'Carlos' })).toBe('Hello Carlos');
  });

  test('replaces multiple variables', () => {
    expect(interpolate('{count} days of {metric}', { count: 7, metric: 'HRV' }))
      .toBe('7 days of HRV');
  });

  test('replaces all occurrences of the same variable', () => {
    expect(interpolate('{val} + {val} = {val}', { val: 'x' }))
      .toBe('x + x = x');
  });

  test('handles numeric values', () => {
    expect(interpolate('Score: {score}%', { score: 78 })).toBe('Score: 78%');
  });

  test('leaves unknown placeholders untouched', () => {
    expect(interpolate('{known} and {unknown}', { known: 'A' }))
      .toBe('A and {unknown}');
  });

  test('handles empty string', () => {
    expect(interpolate('', { foo: 'bar' })).toBe('');
  });

  test('handles empty vars object', () => {
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
  });

  test('handles special regex characters in values', () => {
    expect(interpolate('Path: {path}', { path: 'a/b/c' })).toBe('Path: a/b/c');
  });

  test('real-world: dashboard.dataDate pattern', () => {
    expect(interpolate('Datos de Garmin Connect · {date}', { date: '2026-03-17' }))
      .toBe('Datos de Garmin Connect · 2026-03-17');
  });

  test('real-world: insights.recommendations', () => {
    expect(interpolate('{count} recomendaciones', { count: 3 }))
      .toBe('3 recomendaciones');
  });
});
