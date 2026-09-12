Component: HC-SR501 PIR (Passive Infrared) Motion Sensor

Pin identification:
- VCC (Pin 1): Power supply input. Accepts 4.5V-20V DC. For Arduino 
  projects, connect to the 5V pin specifically — the HC-SR501 does NOT 
  work reliably on 3.3V despite its output being 3.3V logic.
- OUT (Pin 2): Digital output pin. Goes HIGH (approx 3.3V) when motion is 
  detected, LOW (0V) when no motion is detected. Should connect to a 
  digital input pin on the microcontroller.
- GND (Pin 3): Ground connection. Must connect to the circuit's common 
  ground.

Common wiring mistakes:
- Connecting VCC to 3.3V instead of 5V — sensor may not power on correctly 
  or behave unreliably.
- Leaving OUT unconnected to anything meaningful — the sensor will detect 
  motion but nothing will read/respond to it.
- Swapping VCC and GND — this can potentially damage the sensor module.
- The three pins may be labeled/ordered differently across manufacturers; 
  always confirm silkscreen labels (VCC, OUT, GND) rather than assuming 
  pin order.
