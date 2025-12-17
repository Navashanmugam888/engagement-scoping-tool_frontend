import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]/route";
import fs from "fs";
import path from "path";

/**
 * GET /api/admin/role-allocations
 * Retrieves current role allocation data from backend templates.
 */
export async function GET(request) {
  try {
    // Check admin access
    const session = await getServerSession(authOptions);
    if (!session || session.user?.role !== "SUPER_ADMIN") {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Admin access required." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const excelTemplatePath = path.join(
      process.cwd(),
      "..",
      "Engagement_Scoping_backend",
      "backend",
      "data",
      "excel_templates.py"
    );

    console.log("Reading excel templates from:", excelTemplatePath);

    if (!fs.existsSync(excelTemplatePath)) {
      return new Response(
        JSON.stringify({ error: "Template file not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const fileContent = fs.readFileSync(excelTemplatePath, "utf-8");

    // Extract APP_TIERS_DATA from the file
    const appTiersDataStart = fileContent.indexOf("APP_TIERS_DATA = [");
    if (appTiersDataStart === -1) {
      return new Response(
        JSON.stringify({ error: "Could not find APP_TIERS_DATA in template" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Find the end of APP_TIERS_DATA
    let bracketCount = 0;
    let endIndex = appTiersDataStart + "APP_TIERS_DATA = [".length;
    for (let i = appTiersDataStart; i < fileContent.length; i++) {
      if (fileContent[i] === "[") bracketCount++;
      if (fileContent[i] === "]") {
        bracketCount--;
        if (bracketCount === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }

    // Extract and parse the data
    const appTiersDataStr = fileContent.substring(appTiersDataStart, endIndex);

    // Use eval to parse the Python-like data (in production, use a proper parser)
    const appTiersData = eval(appTiersDataStr.replace(/APP_TIERS_DATA = /, ""));

    // Extract APP_TIERS_ROLES
    const appRolesStart = fileContent.indexOf("APP_TIERS_ROLES = [");
    let appRolesEndIndex = fileContent.length;
    if (appRolesStart !== -1) {
      for (let i = appRolesStart; i < fileContent.length; i++) {
        if (fileContent[i] === "]") {
          appRolesEndIndex = i + 1;
          break;
        }
      }
    }

    const appRolesStr = fileContent.substring(appRolesStart, appRolesEndIndex);
    const appRolesData = eval(appRolesStr.replace(/APP_TIERS_ROLES = /, ""));

    // Convert data to UI format (decimal to percentage)
    const tierData = appTiersData.map((tier) => ({
      activity: tier.category,
      total_hours: 0, // Will be calculated or fetched from effort template
      pm1: Math.round(tier.roles["PM USA"] * 100),
      pm2: Math.round(tier.roles["PM India"] * 100),
      architect: Math.round(tier.roles["Architect USA"] * 100),
      srDeliveryLead: Math.round(tier.roles["Sr. Delivery Lead India"] * 100),
      deliveryLead: Math.round(tier.roles["Delivery Lead India"] * 100),
      appLead1: Math.round(tier.roles["App Lead USA"] * 100),
      appLead2: Math.round(tier.roles["App Lead India"] * 100),
      appDeveloper1: Math.round(tier.roles["App Developer USA"] * 100),
      appDeveloper2: Math.round(tier.roles["App Developer India"] * 100),
      integrationLead: Math.round(tier.roles["Integration Lead USA"] * 100),
      integrationDeveloper: Math.round(
        tier.roles["Integration Developer India"] * 100
      ),
      reportingLead: Math.round(tier.roles["Reporting Lead India"] * 100),
      securityLead: Math.round(tier.roles["Security Lead India"] * 100),
    }));

    const availableRoles = appRolesData.map((roleName, idx) => ({
      id: idx + 1,
      roleName: roleName,
      location: roleName.includes("USA") ? "USA" : "India",
    }));

    console.log("Successfully read templates from backend");

    // Read tier thresholds from config.py
    const configPath = path.join(
      process.cwd(),
      "..",
      "Engagement_Scoping_backend",
      "backend",
      "config.py"
    );

    let tierThresholds = [
      { tier: "Tier 1 - Jumpstart", minWeightage: 0, maxWeightage: 60 },
      { tier: "Tier 2 - Foundation Plus", minWeightage: 61, maxWeightage: 100 },
      { tier: "Tier 3 - Enhanced Scope", minWeightage: 101, maxWeightage: 150 },
      {
        tier: "Tier 4 - Advanced Enablement",
        minWeightage: 151,
        maxWeightage: 200,
      },
      { tier: "Tier 5 - Full Spectrum", minWeightage: 201, maxWeightage: 999 },
    ];

    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, "utf-8");
        const tierStart = configContent.indexOf("TIER_THRESHOLDS = [");
        if (tierStart !== -1) {
          const tierEnd = configContent.indexOf("]", tierStart) + 1;
          const tierStr = configContent.substring(tierStart, tierEnd);
          const tierData = eval(tierStr.replace(/TIER_THRESHOLDS = /, ""));
          tierThresholds = tierData;
          console.log("Loaded TIER_THRESHOLDS from config.py");
        }
      } catch (err) {
        console.warn(
          "Could not read TIER_THRESHOLDS from config.py, using defaults"
        );
      }
    }

    // Read effort template data to add subtasks to tierData
    const effortTemplatePath = path.join(
      process.cwd(),
      "..",
      "Engagement_Scoping_backend",
      "backend",
      "data",
      "effort_template.py"
    );

    if (fs.existsSync(effortTemplatePath)) {
      try {
        const effortContent = fs.readFileSync(effortTemplatePath, "utf-8");
        const templateStart = effortContent.indexOf(
          "EFFORT_ESTIMATION_TEMPLATE = {"
        );
        if (templateStart !== -1) {
          let braceCount = 0;
          let templateEnd =
            templateStart + "EFFORT_ESTIMATION_TEMPLATE = {".length;
          for (let i = templateStart; i < effortContent.length; i++) {
            if (effortContent[i] === "{") braceCount++;
            if (effortContent[i] === "}") {
              braceCount--;
              if (braceCount === 0) {
                templateEnd = i + 1;
                break;
              }
            }
          }
          const effortStr = effortContent.substring(templateStart, templateEnd);
          // Parse Python dict to JavaScript object
          let effortData;
          try {
            // Remove Python comments (lines or inline)
            let cleanStr = effortStr
              .replace(/EFFORT_ESTIMATION_TEMPLATE = /, "")
              // Remove inline comments after values (but keep string content intact)
              .split("\n")
              .map((line) => {
                // Find if there's a # not inside quotes
                let inString = false;
                let stringChar = "";
                let commentPos = -1;
                for (let i = 0; i < line.length; i++) {
                  if (
                    (line[i] === '"' || line[i] === "'") &&
                    (i === 0 || line[i - 1] !== "\\")
                  ) {
                    if (!inString) {
                      inString = true;
                      stringChar = line[i];
                    } else if (line[i] === stringChar) {
                      inString = false;
                    }
                  }
                  if (line[i] === "#" && !inString) {
                    commentPos = i;
                    break;
                  }
                }
                return commentPos !== -1 ? line.substring(0, commentPos) : line;
              })
              .join("\n")
              .replace(/True/g, "true")
              .replace(/False/g, "false")
              .replace(/None/g, "null");

            effortData = JSON.parse(cleanStr);
          } catch (parseErr) {
            // Fallback to eval if JSON parsing fails
            console.warn("JSON parse failed, trying eval...", parseErr.message);
            try {
              let cleanStr = effortStr
                .replace(/EFFORT_ESTIMATION_TEMPLATE = /, "")
                .split("\n")
                .map((line) => {
                  let inString = false;
                  let stringChar = "";
                  let commentPos = -1;
                  for (let i = 0; i < line.length; i++) {
                    if (
                      (line[i] === '"' || line[i] === "'") &&
                      (i === 0 || line[i - 1] !== "\\")
                    ) {
                      if (!inString) {
                        inString = true;
                        stringChar = line[i];
                      } else if (line[i] === stringChar) {
                        inString = false;
                      }
                    }
                    if (line[i] === "#" && !inString) {
                      commentPos = i;
                      break;
                    }
                  }
                  return commentPos !== -1
                    ? line.substring(0, commentPos)
                    : line;
                })
                .join("\n");
              effortData = eval("(" + cleanStr + ")");
            } catch (evalErr) {
              console.error(
                "Both JSON and eval parsing failed:",
                evalErr.message
              );
              throw evalErr;
            }
          }

          console.log("Parsed EFFORT_ESTIMATION_TEMPLATE from file");
          console.log("Effort data keys:", Object.keys(effortData).length);
          console.log(
            "Effort template keys:",
            Object.keys(effortData).slice(0, 5)
          ); // Log first 5 keys

          // Merge effort template data with tierData
          tierData.forEach((tier, tierIdx) => {
            // tierData has 'activity' field from APP_TIERS_DATA -> 'category'
            const categoryName = tier.activity || tier.category;
            console.log(`Processing tier ${tierIdx}: "${categoryName}"`);
            if (effortData[categoryName]) {
              const effortInfo = effortData[categoryName];
              tier.total_hours = effortInfo.total || 0;
              tier.subtasks = effortInfo.tasks || {};
              console.log(
                `Merged effort data for: ${categoryName} (${
                  effortInfo.total
                } hours, ${Object.keys(tier.subtasks).length} subtasks)`
              );
            } else {
              console.warn(
                `No effort template found for category: "${categoryName}"`
              );
              console.warn(
                `   Available keys in effort data:`,
                Object.keys(effortData).join(", ")
              );
            }
          });
          console.log(
            "Successfully merged EFFORT_ESTIMATION_TEMPLATE with tierData"
          );
          console.log("Sample merged tier (first):", tierData[0]);
        }
      } catch (err) {
        console.error("Error reading effort template:", err);
        console.warn("Continuing without subtasks");
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        tierData,
        availableRoles,
        tierThresholds,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error reading templates:", error);
    return new Response(
      JSON.stringify({
        error: `Failed to read templates: ${error.message}`,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * POST /api/admin/role-allocations
 * Saves role allocation configurations to the backend Excel templates.
 */
export async function POST(request) {
  try {
    // Check admin access
    const session = await getServerSession(authOptions);
    if (!session || session.user?.role !== "SUPER_ADMIN") {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Admin access required." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await request.json();
    const { tierData, tierThresholds, availableRoles, effortData } = body;

    console.log("Processing role allocations update...");

    // Validate required fields
    if (!tierData || !Array.isArray(tierData)) {
      return new Response(
        JSON.stringify({ error: "Invalid tierData provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Update backend Excel templates with new role allocation data
    const updateResult = await updateBackendExcelTemplates(
      tierData,
      tierThresholds,
      availableRoles
    );

    if (!updateResult.success) {
      return new Response(JSON.stringify({ error: updateResult.error }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Update config.py with tier thresholds and available roles
    if (
      (tierThresholds && tierThresholds.length > 0) ||
      (availableRoles && availableRoles.length > 0)
    ) {
      console.log("Updating config.py...");
      const configUpdateResult = await updateBackendConfig(
        tierThresholds,
        availableRoles
      );

      if (!configUpdateResult.success) {
        return new Response(
          JSON.stringify({ error: configUpdateResult.error }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    // Update effort template if provided
    let effortUpdateResult = { success: true };
    if (effortData && Object.keys(effortData).length > 0) {
      console.log("Processing effort template update...");
      effortUpdateResult = await updateBackendEffortTemplate(effortData);

      if (!effortUpdateResult.success) {
        return new Response(
          JSON.stringify({ error: effortUpdateResult.error }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "All templates updated successfully",
        data: {
          roleAllocationsUpdated: tierData.length,
          effortTemplateUpdated: effortData
            ? Object.keys(effortData).length
            : 0,
          timestamp: new Date().toISOString(),
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error saving allocations:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to save role allocations",
        details: error.message,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Updates the backend Excel templates Python file with new role allocation data
 */
async function updateBackendExcelTemplates(
  tierData,
  tierThresholds,
  availableRoles
) {
  try {
    // Path to the Python backend excel_templates.py
    // From project root: ../Engagement_Scoping_backend/backend/data/excel_templates.py
    const excelTemplatesPath = path.join(
      process.cwd(),
      "..",
      "Engagement_Scoping_backend",
      "backend",
      "data",
      "excel_templates.py"
    );

    console.log("Excel templates path:", excelTemplatesPath);

    // Check if file exists
    if (!fs.existsSync(excelTemplatesPath)) {
      console.error(`File not found: ${excelTemplatesPath}`);
      return {
        success: false,
        error: `Excel templates file not found at ${excelTemplatesPath}`,
      };
    }

    console.log("File found, reading content...");

    // Read current file
    let fileContent = fs.readFileSync(excelTemplatesPath, "utf-8");

    // Generate updated APP_TIERS_DATA
    const updatedAppTiersData = generateAPP_TIERS_DATA(tierData);

    console.log("Replacing APP_TIERS_DATA section...");

    // Find and replace APP_TIERS_DATA section
    const appTiersDataStart = fileContent.indexOf("APP_TIERS_DATA = [");
    if (appTiersDataStart === -1) {
      return {
        success: false,
        error: "Could not find APP_TIERS_DATA in excel_templates.py",
      };
    }

    // Find the closing bracket of APP_TIERS_DATA
    let bracketCount = 0;
    let endIndex = appTiersDataStart + "APP_TIERS_DATA = [".length;
    let foundEnd = false;

    for (let i = appTiersDataStart; i < fileContent.length; i++) {
      if (fileContent[i] === "[") bracketCount++;
      if (fileContent[i] === "]") {
        bracketCount--;
        if (bracketCount === 0) {
          endIndex = i + 1;
          foundEnd = true;
          break;
        }
      }
    }

    if (!foundEnd) {
      return {
        success: false,
        error: "Could not find end of APP_TIERS_DATA in excel_templates.py",
      };
    }

    // Replace APP_TIERS_DATA section
    const beforeAppTiers = fileContent.substring(0, appTiersDataStart);
    const afterAppTiers = fileContent.substring(endIndex);

    fileContent = beforeAppTiers + updatedAppTiersData + afterAppTiers;

    console.log("APP_TIERS_DATA replaced");

    // Update APP_TIERS_ROLES if provided
    if (availableRoles && availableRoles.length > 0) {
      console.log("Replacing APP_TIERS_ROLES section...");
      const updatedRoles = generateAPP_TIERS_ROLES(availableRoles);
      const appRolesStart = fileContent.indexOf("APP_TIERS_ROLES = [");

      if (appRolesStart !== -1) {
        // Find closing bracket
        let rolesEndIndex = appRolesStart + "APP_TIERS_ROLES = [".length;
        for (let i = appRolesStart; i < fileContent.length; i++) {
          if (fileContent[i] === "]") {
            rolesEndIndex = i + 1;
            break;
          }
        }

        const beforeRoles = fileContent.substring(0, appRolesStart);
        const afterRoles = fileContent.substring(rolesEndIndex);
        fileContent = beforeRoles + updatedRoles + afterRoles;
        console.log("APP_TIERS_ROLES replaced");
      }
    }

    // Write updated content back
    console.log("Writing updated content to file...");
    fs.writeFileSync(excelTemplatesPath, fileContent, "utf-8");

    console.log(`Successfully updated ${excelTemplatesPath}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating backend excel templates:", error);
    return {
      success: false,
      error: `Failed to update backend templates: ${error.message}`,
    };
  }
}

/**
 * Generates the APP_TIERS_DATA Python code from the UI tier data
 */
function generateAPP_TIERS_DATA(tierData) {
  const entries = tierData.map((tier, idx) => {
    const roles = {
      "PM USA": tier.pm1 / 100,
      "PM India": tier.pm2 / 100,
      "Architect USA": tier.architect / 100,
      "Sr. Delivery Lead India": tier.srDeliveryLead / 100,
      "Delivery Lead India": tier.deliveryLead / 100,
      "App Lead USA": tier.appLead1 / 100,
      "App Lead India": tier.appLead2 / 100,
      "App Developer USA": tier.appDeveloper1 / 100,
      "App Developer India": tier.appDeveloper2 / 100,
      "Integration Lead USA": tier.integrationLead / 100,
      "Integration Developer India": tier.integrationDeveloper / 100,
      "Reporting Lead India": tier.reportingLead / 100,
      "Security Lead India": tier.securityLead / 100,
    };

    const rolesStr = Object.entries(roles)
      .map(([roleName, value]) => `            "${roleName}": ${value}`)
      .join(",\n");

    return `    {
        "row_index": ${idx},
        "category": "${tier.activity}",
        "roles": {
${rolesStr}
        }
    }`;
  });

  return `APP_TIERS_DATA = [\n${entries.join(",\n")}\n]`;
}

/**
 * Generates the APP_TIERS_ROLES Python code
 */
function generateAPP_TIERS_ROLES(availableRoles) {
  const entries = availableRoles.map((role) => `    "${role.roleName}"`);
  return `APP_TIERS_ROLES = [\n${entries.join(",\n")}\n]`;
}

/**
 * Updates the backend effort template Python file
 */
async function updateBackendEffortTemplate(effortData) {
  try {
    // Path to the Python backend effort_template.py
    // From project root: ../Engagement_Scoping_backend/backend/data/effort_template.py
    const effortTemplatePath = path.join(
      process.cwd(),
      "..",
      "Engagement_Scoping_backend",
      "backend",
      "data",
      "effort_template.py"
    );

    console.log("Effort template path:", effortTemplatePath);

    // Check if file exists
    if (!fs.existsSync(effortTemplatePath)) {
      console.error(`File not found: ${effortTemplatePath}`);
      return {
        success: false,
        error: `Effort template file not found at ${effortTemplatePath}`,
      };
    }

    console.log("✅ File found, reading content...");

    // Read current file
    let fileContent = fs.readFileSync(effortTemplatePath, "utf-8");

    // Find and replace EFFORT_ESTIMATION_TEMPLATE section
    const templateStart = fileContent.indexOf("EFFORT_ESTIMATION_TEMPLATE = {");
    if (templateStart === -1) {
      return {
        success: false,
        error:
          "Could not find EFFORT_ESTIMATION_TEMPLATE in effort_template.py",
      };
    }

    // Find the closing bracket
    let braceCount = 0;
    let endIndex = templateStart + "EFFORT_ESTIMATION_TEMPLATE = {".length;
    let foundEnd = false;

    for (let i = templateStart; i < fileContent.length; i++) {
      if (fileContent[i] === "{") braceCount++;
      if (fileContent[i] === "}") {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i + 1;
          foundEnd = true;
          break;
        }
      }
    }

    if (!foundEnd) {
      return {
        success: false,
        error: "Could not find end of EFFORT_ESTIMATION_TEMPLATE",
      };
    }

    console.log("🔄 Replacing EFFORT_ESTIMATION_TEMPLATE section...");
    console.log(
      "📊 Effort categories to save:",
      Object.keys(effortData).length
    );

    // Generate new template code with proper Python dict structure
    let newTemplate = "EFFORT_ESTIMATION_TEMPLATE = {\n";

    for (const [category, data] of Object.entries(effortData)) {
      // Use the 'total' field directly (already calculated as sum of subtasks in frontend)
      const totalHours = parseFloat(data.total) || 0;
      const subtasks = data.tasks || {};

      console.log(
        `Saving category: "${category}" (total: ${totalHours}h, subtasks: ${
          Object.keys(subtasks).length
        })`
      );

      newTemplate += `    "${category}": {\n`;
      newTemplate += `        "total": ${totalHours},\n`;
      newTemplate += `        "tasks": {\n`;

      for (const [taskName, taskHours] of Object.entries(subtasks)) {
        const hours = parseFloat(taskHours) || 0;
        newTemplate += `            "${taskName}": ${hours},\n`;
      }

      newTemplate += `        }\n`;
      newTemplate += `    },\n`;
    }

    newTemplate += "}\n";
    console.log("Generated new EFFORT_ESTIMATION_TEMPLATE structure");

    // Replace the section
    const beforeTemplate = fileContent.substring(0, templateStart);
    const afterTemplate = fileContent.substring(endIndex);
    fileContent = beforeTemplate + newTemplate + afterTemplate;

    console.log("Writing updated content to file...");
    fs.writeFileSync(effortTemplatePath, fileContent, "utf-8");

    console.log(`Successfully updated ${effortTemplatePath}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating backend effort template:", error);
    return {
      success: false,
      error: `Failed to update effort template: ${error.message}`,
    };
  }
}
/**
 * Updates the backend config.py with new tier thresholds and available roles
 */
async function updateBackendConfig(tierThresholds, availableRoles) {
  try {
    const configPath = path.join(
      process.cwd(),
      "..",
      "Engagement_Scoping_backend",
      "backend",
      "config.py"
    );

    console.log("Reading config.py...");

    if (!fs.existsSync(configPath)) {
      return {
        success: false,
        error: `Config file not found at ${configPath}`,
      };
    }

    let fileContent = fs.readFileSync(configPath, "utf-8");

    // Update TIER_THRESHOLDS if provided
    if (tierThresholds && tierThresholds.length > 0) {
      console.log("Replacing TIER_THRESHOLDS section...");
      const tierStart = fileContent.indexOf("TIER_THRESHOLDS = [");
      if (tierStart !== -1) {
        let tierEnd = tierStart + "TIER_THRESHOLDS = [".length;
        let bracketCount = 0;
        for (let i = tierStart; i < fileContent.length; i++) {
          if (fileContent[i] === "[") bracketCount++;
          if (fileContent[i] === "]") {
            bracketCount--;
            if (bracketCount === 0) {
              tierEnd = i + 1;
              break;
            }
          }
        }

        let newTierThresholds = "TIER_THRESHOLDS = [\n";
        tierThresholds.forEach((threshold) => {
          newTierThresholds += `    {"tier": "${threshold.tier}", "minWeightage": ${threshold.minWeightage}, "maxWeightage": ${threshold.maxWeightage}},\n`;
        });
        newTierThresholds += "]\n";

        const beforeTier = fileContent.substring(0, tierStart);
        const afterTier = fileContent.substring(tierEnd);
        fileContent = beforeTier + newTierThresholds + afterTier;
        console.log("TIER_THRESHOLDS replaced");
      }
    }

    // Update AVAILABLE_ROLES if provided
    if (availableRoles && availableRoles.length > 0) {
      console.log("Replacing AVAILABLE_ROLES section...");
      const rolesStart = fileContent.indexOf("AVAILABLE_ROLES = [");
      if (rolesStart !== -1) {
        let rolesEnd = rolesStart + "AVAILABLE_ROLES = [".length;
        for (let i = rolesStart; i < fileContent.length; i++) {
          if (fileContent[i] === "]") {
            rolesEnd = i + 1;
            break;
          }
        }

        let newRoles = "AVAILABLE_ROLES = [\n";
        availableRoles.forEach((role) => {
          const roleName = role.roleName || role;
          newRoles += `    "${roleName}",\n`;
        });
        newRoles += "]\n";

        const beforeRoles = fileContent.substring(0, rolesStart);
        const afterRoles = fileContent.substring(rolesEnd);
        fileContent = beforeRoles + newRoles + afterRoles;
        console.log("AVAILABLE_ROLES replaced");
      }
    }

    // Write updated content back
    console.log("Writing updated content to config.py...");
    fs.writeFileSync(configPath, fileContent, "utf-8");

    console.log(`Successfully updated ${configPath}`);
    return { success: true };
  } catch (error) {
    console.error("Error updating backend config:", error);
    return {
      success: false,
      error: `Failed to update config: ${error.message}`,
    };
  }
}
