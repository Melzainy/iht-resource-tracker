# Resource Tracker — Excel import report

Source: `Immersive_Homes_Resource_Planner_v4.xlsx` (sheets: Projects, Team & Capacity, Task Input)

```
People imported from Excel:                 19
People added (Team US, Abhishek, Amin):     8
Projects imported:                          4
Tasks imported:                             46
Tasks with missing Start:                   38
Tasks with missing Due:                     32
Tasks with missing Hrs/Week:                46
Tasks with missing Status:                  31
Tasks with missing Priority:                30
Unmatched people:                           0
Unmatched projects:                         0
```

## Tasks per person

| Person | Tasks |
|---|---:|
| Mansour | 1 |
| Mai | 5 |
| Mohit | 7 |
| Parvez | 11 |
| Satendra | 1 |
| Anees | 4 |
| Reilly | 2 |
| Ali | 1 |
| Jared | 1 |
| Kiran | 13 |

## Notes

- Project names trimmed to match the Projects sheet: "Morgan " → "Morgan"
- Ignored: PivotTable caches and the "Example Project" rows in Task Input columns K–Q; the Manager Timeline and System Data sheets (formulas only).
- People added after the import (Team US, Abhishek, Amin) have no weekly capacity yet: the workbook gives none, so it is left blank rather than invented.
