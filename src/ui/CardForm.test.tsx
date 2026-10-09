import { fireEvent, render, screen } from '@testing-library/react-native';
import { CardForm } from './CardForm';

const now = () => new Date(2026, 8, 28);

test('Pay does nothing until the whole card is valid, then submits', async () => {
  const onSubmit = jest.fn();
  await render(<CardForm totalCents={10500} disabled={false} onSubmit={onSubmit} now={now} />);

  await fireEvent.changeText(screen.getByLabelText('Card number'), '4242424242424242');
  await fireEvent.press(screen.getByText('Pay $105.00'));
  expect(onSubmit).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('Expiry date'), '1228');
  await fireEvent.changeText(screen.getByLabelText('Security code'), '123');
  await fireEvent.press(screen.getByText('Pay $105.00'));
  expect(onSubmit).toHaveBeenCalledWith({ number: '4242 4242 4242 4242', expiry: '12/28', cvc: '123' });
});

test('autofill expiry arrives as MM/YYYY in one change and is normalized', async () => {
  await render(<CardForm totalCents={10500} disabled={false} onSubmit={jest.fn()} now={now} />);
  const input = screen.getByLabelText('Expiry date');
  // Autofill never types: the whole value lands in a single change event.
  await fireEvent.changeText(input, '12/2028');
  expect(input.props.value).toBe('12/28');
  expect(screen.queryByText('This card has expired')).toBeNull();
  expect(screen.queryByText('Use MM/YY')).toBeNull();
});

test('complete-but-invalid number shows the error immediately, no blur needed', async () => {
  await render(<CardForm totalCents={10500} disabled={false} onSubmit={jest.fn()} now={now} />);
  await fireEvent.changeText(screen.getByLabelText('Card number'), '4242424242424241');
  expect(screen.getByText("That card number isn't valid")).toBeTruthy();
});

test('incomplete number shows no error while typing, but does after blur', async () => {
  await render(<CardForm totalCents={10500} disabled={false} onSubmit={jest.fn()} now={now} />);
  const input = screen.getByLabelText('Card number');
  await fireEvent.changeText(input, '4242');
  expect(screen.queryByText('Card number is incomplete')).toBeNull();
  await fireEvent(input, 'blur');
  expect(screen.getByText('Card number is incomplete')).toBeTruthy();
});

test('an error clears on the keystroke that fixes the field', async () => {
  await render(<CardForm totalCents={10500} disabled={false} onSubmit={jest.fn()} now={now} />);
  const input = screen.getByLabelText('Card number');
  await fireEvent.changeText(input, '4242424242424241');
  expect(screen.getByText("That card number isn't valid")).toBeTruthy();
  await fireEvent.changeText(input, '4242424242424242');
  expect(screen.queryByText("That card number isn't valid")).toBeNull();
});

test('autofilled MM/YYYY expiry is normalized', async () => {
  await render(<CardForm totalCents={10500} disabled={false} onSubmit={jest.fn()} now={now} />);
  await fireEvent.changeText(screen.getByLabelText('Expiry date'), '12/2028');
  expect(screen.getByLabelText('Expiry date').props.value).toBe('12/28');
});

test('switching from Amex to Visa trims the 4th CVC digit', async () => {
  await render(<CardForm totalCents={10500} disabled={false} onSubmit={jest.fn()} now={now} />);
  await fireEvent.changeText(screen.getByLabelText('Card number'), '3782');
  await fireEvent.changeText(screen.getByLabelText('Security code'), '1234');
  expect(screen.getByLabelText('Security code').props.value).toBe('1234');
  await fireEvent.changeText(screen.getByLabelText('Card number'), '4242');
  expect(screen.getByLabelText('Security code').props.value).toBe('123');
});
