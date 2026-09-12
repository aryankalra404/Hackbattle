Component: 5mm LED (generic, standard forward-voltage red/similar)

Pin identification and polarity:
- The anode (positive leg) is the LONGER lead.
- The cathode (negative leg) is the SHORTER lead.
- Current must flow from anode to cathode for the LED to light.
- If polarity is reversed, the LED will not light. It may be damaged if 
  reverse voltage exceeds the maximum reverse voltage rating (~5V typical 
  for standard LEDs).

Electrical specifications:
- Typical forward voltage (VF): 1.8-2.2V at 20mA for red LEDs (varies by 
  color: blue/white LEDs run higher, ~3.0-3.4V).
- A current-limiting resistor MUST be placed in series with the LED to 
  prevent excessive current and burnout. Without one, the LED can be 
  damaged or destroyed almost instantly when connected to a 5V supply.
- Recommended resistor value for a red LED on 5V: approximately 220 ohms 
  (calculated via R = (Vsupply - Vled) / Iled).
