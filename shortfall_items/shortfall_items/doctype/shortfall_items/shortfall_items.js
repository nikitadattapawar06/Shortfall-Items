// =======================================================
// LOADER HTML
// =======================================================
function get_loader_html(message = "Loading...") {
    return `
        <div style="
            display:flex;
            align-items:center;
            gap:12px;
            padding:20px;
            background:#f7f9ff;
            border:1px solid #dbe3ff;
            border-radius:6px;
            color:#3f51b5;
            font-weight:600;">
            <i class="fa fa-circle-o-notch fa-spin fa-lg"></i> ${message}
        </div>
    `;
}

// =======================================================
// CHECK IF ANY MR EXISTS (excluding cancelled MR)
// =======================================================
async function work_order_has_any_mr(wo_name) {
    let mr = await frappe.db.get_list("Material Request", {
        filters: {
            work_order: wo_name,
            custom_shortfall_item_mr: 1,
            docstatus: ["!=", 2] // Exclude Cancelled
        },
        limit: 1
    });
    return mr.length > 0;
}

// =======================================================
// CLIENT SCRIPT
// =======================================================
frappe.ui.form.on('Shortfall Items', {

    refresh(frm) {
        frm.trigger("bind_buttons");
    },

    bind_buttons(frm) {
        frm.fields_dict.get_work_orders.$input?.off("click").on("click",
            () => frm.trigger("load_work_orders")
        );
        frm.fields_dict.get_purchase_request.$input?.off("click").on("click",
            () => frm.trigger("load_purchase_requests")
        );
    },

    // ===================================================
    // 1️⃣ LOAD WORK ORDERS WITH TRUE SHORTFALL
    // ===================================================
    async load_work_orders(frm) {

        frm.set_df_property("work_order", "options",
            get_loader_html("Scanning Work Orders for Shortfall...")
        );

        let work_orders = await frappe.db.get_list("Work Order", {
            filters: { docstatus: 1, status: ["!=", "Completed"] },
            fields: ["name", "status"]
        });

        let rows = [];

        for (let wo of work_orders) {

            // Skip if MR exists (not cancelled)
            if (await work_order_has_any_mr(wo.name)) continue;

            let wo_doc = await frappe.db.get_doc("Work Order", wo.name);

            for (let item of wo_doc.required_items) {

                // Use valid source warehouse
                let source_wh = item.source_warehouse || wo_doc.source_warehouse || wo_doc.wip_warehouse;
                if (!source_wh) continue;

                let bin = await frappe.db.get_value("Bin", {
                    item_code: item.item_code,
                    warehouse: source_wh
                }, ["actual_qty", "projected_qty"]);

                let actual_qty = bin?.message?.actual_qty || 0;
                let projected_qty = bin?.message?.projected_qty || 0;
                let required_qty = item.required_qty || 0;

                let shortfall = required_qty - actual_qty;

                if (shortfall <= 0) continue;  // Only include real shortfall

                rows.push({
                    wo_name: wo.name,
                    wo_status: wo.status,
                    item: item.item_code,
                    source_wh: source_wh,
                    req_qty: required_qty,
                    actual_qty: actual_qty,
                    projected_qty: projected_qty,
                    shortfall: shortfall
                });
            }
        }

        if (!rows.length) {
            frm.set_df_property("work_order", "options",
                "<p style='color:green;font-weight:bold;'>✅ No Work Orders with shortfall.</p>"
            );
            return;
        }

        // Group shortfalls by Work Order
        let grouped = {};
        rows.forEach(r => {
            if (!grouped[r.wo_name]) grouped[r.wo_name] = [];
            grouped[r.wo_name].push(r);
        });

        // Build HTML
        let html = `
            <style>
                .wo-head {
                    background:#eef2ff;
                    padding:8px;
                    margin-top:12px;
                    border-left:4px solid #4b74ff;
                    font-weight:bold;
                }
                .mr-btn {
                    float:right;
                    font-size:12px;
                    padding:4px 8px;
                }
            </style>
        `;

        for (let wo in grouped) {
            let wo_status = grouped[wo][0].wo_status;

            html += `
                <div class="wo-head">
                    <a href="/app/work-order/${wo}" target="_blank">${wo}</a>
                    | Status: ${wo_status}
                    <button class="btn btn-primary btn-xs mr-btn" data-wo="${wo}">
                        Create Material Request
                    </button>
                </div>

                <table class="table table-bordered table-sm">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Source WH</th>
                            <th>Required</th>
                            <th>Stock</th>
                            <th>Projected</th>
                            <th>Shortfall</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            grouped[wo].forEach(r => {
                html += `
                    <tr>
                        <td>${r.item}</td>
                        <td>${r.source_wh}</td>
                        <td>${r.req_qty}</td>
                        <td>${r.actual_qty}</td>
                        <td>${r.projected_qty}</td>
                        <td><b style="color:red;">${r.shortfall}</b></td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
        }

        frm.set_df_property("work_order", "options", html);

        // Create MR button
        setTimeout(() => {
            $(".mr-btn").off("click").on("click", function () {
                let wo = $(this).data("wo");

                frappe.call({
                    method: "create_shortfall_material_request",
                    args: { work_order: wo },
                    freeze: true,
                    freeze_message: "Creating Material Request...",
                    callback: function (r) {

                        if (!r.message) return;

                        if (r.message.already_exists) {
                            frappe.msgprint(`⚠ MR already exists: 
                                <a href="/app/material-request/${r.message.mr_name}" target="_blank">
                                    ${r.message.mr_name}
                                </a>`);
                            return;
                        }

                        frappe.msgprint(`<b>✅ Material Request Created:</b><br>
                            <a href="/app/material-request/${r.message.mr_name}" target="_blank">
                                ${r.message.mr_name}
                            </a>`
                        );

                        frm.trigger("load_work_orders");
                    }
                });
            });
        }, 200);
    },

    // ===================================================
    // 2️⃣ LOAD DRAFT MATERIAL REQUESTS
    // ===================================================
    async load_purchase_requests(frm) {

        frm.set_df_property("purchase_request", "options",
            get_loader_html("Loading Draft Shortfall Requests...")
        );

        let mr_list = await frappe.db.get_list("Material Request", {
            filters: { custom_shortfall_item_mr: 1, docstatus: 0 },
            fields: ["name", "work_order"],
            order_by: "creation desc"
        });

        if (!mr_list.length) {
            frm.set_df_property("purchase_request", "options",
                "<p style='color:orange;font-weight:bold;'>⚠ No Draft Shortfall Requests found.</p>"
            );
            return;
        }

        let html = `
            <style>
                .mr-head {
                    background:#fff4e6;
                    padding:8px;
                    margin-top:12px;
                    border-left:4px solid #ff9800;
                    font-weight:bold;
                }
            </style>
        `;

        for (let mr of mr_list) {

            let mr_doc = await frappe.db.get_doc("Material Request", mr.name);
            let wo_doc = await frappe.db.get_doc("Work Order", mr.work_order);

            html += `
                <div class="mr-head">
                    Purchase Request: 
                    <a href="/app/material-request/${mr.name}" target="_blank">${mr.name}</a>
                    &nbsp;| WO: 
                    <a href="/app/work-order/${mr.work_order}" target="_blank">${mr.work_order}</a>
                    &nbsp;| WO Status: ${wo_doc.status}
                    <span style="float:right;">MR Status: Draft</span>
                </div>

                <table class="table table-bordered table-sm">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Source WH</th>
                            <th>Target WH</th>
                            <th>Required</th>
                            <th>Stock</th>
                            <th>Projected</th>
                            <th>Shortfall</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            for (let item of mr_doc.items) {
                let wo_item = wo_doc.required_items.find(i => i.item_code === item.item_code) || {};
                let source_wh = wo_item.source_warehouse || "N/A";
                let required_qty = wo_item.required_qty || item.qty;

                let stock = await frappe.db.get_value("Bin", {
                    item_code: item.item_code,
                    warehouse: source_wh
                }, ["actual_qty", "projected_qty"]);

                let actual = stock?.message?.actual_qty || 0;
                let projected = stock?.message?.projected_qty || 0;
                let shortfall = required_qty - actual;
                if (shortfall < 0) shortfall = 0;

                html += `
                    <tr>
                        <td>${item.item_code}</td>
                        <td>${source_wh}</td>
                        <td>${item.warehouse || "N/A"}</td>
                        <td>${required_qty}</td>
                        <td>${actual}</td>
                        <td>${projected}</td>
                        <td><b style="color:red;">${shortfall}</b></td>
                    </tr>
                `;
            }

            html += `</tbody></table>`;
        }

        frm.set_df_property("purchase_request", "options", html);
    }
});
