Payment succeeds
      ↓
Notification Service publishes ONE event (e.g. "order_confirmed")
      ↓
   SNS Topic (fans the event out — publish once, deliver to many)
      ↓
   ┌────────────┬────────────┬────────────┐
   ↓            ↓            ↓
Order Queue   Email Queue   SMS Queue
   ↓            ↓            ↓
Order Worker  Email Worker  SMS Worker
   ↓            ↓            ↓
Order Service  SendGrid/SES  Twilio/SMS Gateway