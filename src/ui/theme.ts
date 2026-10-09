// One place for the visual constants, so every component agrees on color,
// spacing and shape. Change a value here and the whole screen follows: the
// same job design tokens do in a larger system.

export const color = {
  bg: '#FFFFFF',
  surface: '#F5F6F8',
  ink: '#111418',
  subtle: '#6B7280',
  border: '#D6DAE0',
  primary: '#2563EB',
  primaryDisabled: '#A5C0F5',
  danger: '#C62828',
  dangerBg: '#FDECEA',
  infoBg: '#E8F0FE',
  warnBg: '#FFF4E5',
  successInk: '#166534',
  applePay: '#000000',
  googlePay: '#202124',
  affirm: '#4A4AF4',
};

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };

export const radius = { s: 8, m: 10, l: 16 };

export const type = {
  title: { fontSize: 28, fontWeight: '700' as const, color: color.ink },
  heading: { fontSize: 17, fontWeight: '600' as const, color: color.ink },
  body: { fontSize: 15, color: color.ink },
  label: { fontSize: 13, color: color.subtle },
  money: { fontSize: 17, fontWeight: '700' as const, color: color.ink },
};
