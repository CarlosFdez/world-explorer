# World Explorer

GM tool for hexcrawl campaigns that allows displaying a second manual fog of war (with color or image) only over the background layer, while keeping the grid, tokens, and tiles visible. Grid tiles can be removed manually by the GM to reveal the underlying map on successing scouting or mapping checks. Enable in scene configuration.

If you're feeling generous, you can send something through [Paypal](https://paypal.me/carlosfernandez1779?locale.x=en_US) if you want.

![image](https://github.com/user-attachments/assets/a70120ac-b992-493e-94dc-c2569d8351c5)

## Features

The module can be set to be enabled for a scene via the last tab in the scene settings. Once enabled, the button for it will show up on the canvas controls to the left. From there, you can either the map in toggle mode (where you enable/disable tiles one at time) or in reveal or hide modes. You can also reset the entire map from there (either hiding everything or showing everything).

![image](https://github.com/user-attachments/assets/814debd6-aab8-4e69-b355-d3f2dfc9d42b)

### Separate Player and Gamemaster Opacities

By default, the GM has 75% opacity and players have 100% opacity. While the GM can see what's underneath, the view is completely blocked for players unless you set it otherwise. The GM can change their own opacity from the canvas controls whenever they want.

![image](https://github.com/user-attachments/assets/69b181b3-d62f-4496-b815-616fff2f5921)

![image](https://github.com/user-attachments/assets/3e7ef0e1-ff66-4c1f-a816-81aac0023ef7)

### Automatic Revealing

While the module expects a manual approach, you can optionally set the module to automatically reveal tiles that players have ventured through. It only performs these updates for tokens that have a player owner. Tokens used to represent wandering encounters won't get revealed to players.
