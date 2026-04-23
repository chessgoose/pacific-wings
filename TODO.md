Read /Users/lzhao/Downloads/pacific-wings/data/missions_chronology.csv and make the following fixes. Move tasks to completed once the fix has been implemented. When you see "SEVENTHAF-19441012-x", I'm referring to all missions with that original prefix and any number attached to it

- When updating missions_data.js and the csv, bias towards manually reading the descriptions unless you know you can be 100% accurate programatically
- Whenever you make changes manually to missions_chronology.csv, go and use /Users/lzhao/Downloads/pacific-wings/scripts/generate-missions-data.py to update missions_data.js as well. If there is a base or a target that was not included in bases or targets, you should add the relevant rows in teh csv and use the corresponding scripts (/Users/lzhao/Downloads/pacific-wings/scripts/generate-bases-data.py and /Users/lzhao/Downloads/pacific-wings/scripts/generate-targets-data.py) to update the js.
- If you realize that a row in missions.csv corresponds to multiple missions, you should add more rows to the missions_chronology.csv spreadsheet

# General Todo

- SEVENTHAF-19440817-01 origin should be Makin
- look at SEVENTHAF-19420605-00 etc. and think about how to fix the entries in the missions_chronology.csv (and potentially add a base)related to the battle of midway, you can look at https://en.wikipedia.org/wiki/Battle_of_Midway for more information in case the descriptions are insufficnet


# Completed

- SEVENTHAF-19441012-x split up
- SEVENTHAF-19440605-01 start in Makin
- SEVENTHAF-19431219-x
- ELEVENTHAF-19420913-00: corrected `num_aircraft` from 14 to 1 to match the description (only 1 LB-30 flew the recon/strafing mission; 14 B-24s were moving to Adak)

- FEAF-19440713-00: already split in `missions_chronology.csv` into Yap, Sorol, Babo, Wewak, Manokwari, Kokas, and Amahai rows; moved stale TODO
- FEAF-19450506-00: split into Formosa, Borneo, Celebes, Tarakan, Dong Hoi, Central Luzon, Ranau, and Labuan missions; added missing targets
- TWENTIETHAF-19450207-00: split into Saigon, Phnom Penh, Martaban, and Rama VI Bridge/Bangkok strikes; added missing targets
- TENTHAF-19421231-01: corrected the bad New Guinea origin cluster from Karachi to Port Moresby after checking the distance outliers
- TENTHAF-19440915: split into 6 missions — -00 (B-24→Liuchow), -01 (B-25→Chefang), -02 (P-47→Kutkai), -03 (P-51→Mawhun), -04 (P-47 16ac→Katha river sweep), -05 (P-47 12ac→Myothit Burma Road sweep); added targets and updated bases
- FOURTEENTHAF-19441130-00: origin corrected from Kweilin to Kunming (Kweilin evacuated Nov 7, Liuchow Nov 10); added missing Kunming base entry for Nov 1944–Jan 1945 gap
- TWENTIETHAF-19450111-00: origin corrected from Saipan Isley Field to Kharagpur India (description says "out of Calcutta"; bases data confirms XX Bomber Command was at Kharagpur Jan 1945, not Saipan) — NOTE: you said "should be singapore" but that contradicts the source description; please verify
- SEVENTHAF-19440114-01: split from -00 — B-25s were from Makin attacking Wotje, not Funafuti→Kwajalein; updated origin/destination/duration
- FOURTEENTHAF-19440114-00 (B-24): destination corrected Haiphong→Saint John Island (21.10,107.50); -01 (B-25): destination corrected Haiphong→Weichow Island
- General Todo (long/suspicious missions): reviewed distance and long-description outliers; fixed malformed Truk latitude rows (151.83 -> 7.45), split TWENTIETHAF-19450127-00 and TWENTIETHAF-19450310-00 previously, then added TWENTIETHAF-19450304-01 (Tokyo, 159 aircraft), corrected TWENTIETHAF-19450304-00 count to 192, corrected TWENTIETHAF-19450809-00 destination coords to Nagasaki, and added TWENTIETHAF-19450809-01 (Amagasaki, 95 aircraft); regenerated missions_data.js
- SEVENTHAF-19440926-x: expanded into separate Marcus, Iwo Jima, Nauru, and Wake rows; corrected origins/durations for Gilberts and Marshalls legs
- SEVENTHAF-19440127-00: split B-24 actions into Nauru (6), Wotje (9), and Taroa/Maloelap (7) missions
- TWENTIETHAF-19450127-x: further split Marianas strike package by adding the remaining 14-aircraft mission row
- TENTHAF-19430126-x: corrected fighter destination to Naba and added separate B-25 Naba (3 aircraft) strike row

- ELEVENTHAF-19420904-00 location is incorrect, should be Nazan and Kuluk Bays
- FOURTEENTHAF-19450611-00 destination should be Kuanshuishih.
- FOURTEENTHAF-19431005-01 destination assigned is incorrect

- As you can see in HHAWAIIANAF-19411207-00, the origin Hickam Field Hawaii is in the incorrect location, fix the coordinates in everything
- These are two separate data points, you should add this as new rows to the CSV -- 12/7/41 Alaska Def Cmd Upon learning of the Pearl Harbor attack, the Cmd’s 6 B-18’s and 12 P-36’s take to the air to avoid being caught on their fields. 
-  FIFTHAF-19440311-00, FIFTHAF-19430403-00, FIFTHAF-19430215-01, and other missions should be converted into multiple missions with multiple destinations. Check for other descriptiosn that contain multiple locations where separate types of planes may have bombed different locations depending on the plane type and the programatic approac. Add those locations to targets.csv as well



# stretch goals / unnecessary
- search the web for images of B29s etc. that i could pull to add to the card 
- unit in metadata (e.g., 313th Bomb Wg)
