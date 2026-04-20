Read /Users/lzhao/Downloads/pacific-wings/data/missions_chronology.csv and make the following fixes

# Specific Todo
- ELEVENTHAF-19420904-00 location is incorrect, should be Nazan and Kuluk Bays
- FOURTEENTHAF-19450611-00 destination should be Kuanshuishih.

- FOURTEENTHAF-19431005-01 destination assigned is incorrect

# General Todo
- FOURTEENTHAF-19450402-01 and other similar missions should be split up more specifically since there are multiple trips with different destinations, you will probably need to manually inspect the description to figure out the best way to do so, update the targets as well

# Completed
- As you can see in HHAWAIIANAF-19411207-00, the origin Hickam Field Hawaii is in the incorrect location, fix the coordinates in everything
- These are two separate data points, you should add this as new rows to the CSV -- 12/7/41 Alaska Def Cmd Upon learning of the Pearl Harbor attack, the Cmd’s 6 B-18’s and 12 P-36’s take to the air to avoid being caught on their fields. 
-  FIFTHAF-19440311-00, FIFTHAF-19430403-00, FIFTHAF-19430215-01, and other missions should be converted into multiple missions with multiple destinations. Check for other descriptiosn that contain multiple locations where separate types of planes may have bombed different locations depending on the plane type and the programatic approac. Add those locations to targets.csv as well

