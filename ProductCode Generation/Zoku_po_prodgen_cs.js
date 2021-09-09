/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(["N/record", "N/search", "N/ui/dialog"], /**
 * @param {record} record
 * @param {search} search
 * @param {dialog} dialog
 */ function (record, search, dialog) {
  /**
   * Function to be executed after page is initialized.
   *
   * @param {Object} scriptContext
   * @param {Record} scriptContext.currentRecord - Current form record
   * @param {string} scriptContext.mode - The mode in which the record is being accessed (create, copy, or edit)
   *
   * @since 2015.2
   */
  function pageInit(scriptContext) {
    //This is a required parameter apparently.
  }

  function generateFlow() {
    var url = new URL(window.location.href);
    var internalid = url.searchParams.get("id");
    var status;
    var retailLineId = new Array();
    var sampleLineId = new Array();
    var counter = 0;
    var options = {
      title: "Warning",
      message:
        "Once confirmed, this will generate the Product Codes for all applicable items in the transaction.\nPlease make sure that there are no further changes to the transaction before proceeding.\nThe screen may freeze while the Product codes are being generated. PLEASE DO NOT CLOSE THE WINDOW UNTIL THE CONFIRMATION DIALOG APPEARS. \nConfirm Product Code generation?",
    };

    function success(result) {
      if (result) {
        //User confirms. Proceed with code generation
        console.log("User proceeded.", result);

        //Use the local script saved search
        var transactionSearchObj = search.create({
          type: "transaction",
          filters: [
            ["internalid", "anyof", internalid],
            "AND",
            ["mainline", "is", "F"],
            "AND",
            ["item.type", "anyof", "InvtPart"],
            "AND",
            ["item.isserialitem", "is", "T"],
            "AND",
            [
              "formulatext: {item.custitem_zoku_prodcodetype}",
              "isnotempty",
              "",
            ],
          ],
          columns: [
            search.createColumn({
              name: "tranid",
              sort: search.Sort.ASC,
              label: "Document Number",
            }),
            search.createColumn({
              name: "transactionnumber",
              label: "Transaction Number",
            }),
            search.createColumn({
              name: "otherrefnum",
              label: "PO/Check Number",
            }),
            search.createColumn({ name: "statusref", label: "Status" }),
            search.createColumn({ name: "item", label: "Item" }),
            search.createColumn({
              name: "type",
              join: "item",
              label: "Type",
            }),
            search.createColumn({ name: "line", label: "Line ID" }),
            search.createColumn({
              name: "formulatext",
              formula: "{item.custitem_zoku_prodcodetype}",
              label: "Formula (Text)",
            }),
          ],
        });
        var searchResultCount = transactionSearchObj.runPaged().count;
        transactionSearchObj.run().each(function (result) {
          if (result.getValue({ name: "formulatext" }) == "Retail")
            retailLineId.push(result.getValue({ name: "line" }));
          else if (result.getValue({ name: "formulatext" }) == "Sample")
            sampleLineId.push(result.getValue({ name: "line" }));
          return true;
        });
        console.log("retailLineId results", retailLineId);
        console.log("sampleLineId results", sampleLineId);

        //Check if any of the items in the transaction fit the criteria
        if (searchResultCount) {
          //Load the transaction record
          var po = record.load({
            type: record.Type.PURCHASE_ORDER,
            id: internalid,
            isDynamic: true,
          });
          var lineCount = po.getLineCount({ sublistId: "item" });
          var lineQuantity = 0;
          var retailLine = -1;
          var sampleLine = -1;

          //Find the line where the items would have the Product Codes
          for (var x = 0; x < lineCount; x++) {
            //Separated these to variables to make the if-statements easier to read
            retailLine = retailLineId.indexOf(
              po.getSublistValue({
                sublistId: "item",
                fieldId: "line",
                line: x,
              })
            );

            sampleLine = sampleLineId.indexOf(
              po.getSublistValue({
                sublistId: "item",
                fieldId: "line",
                line: x,
              })
            );
            /************END of var assignment**************/

            if (retailLine > -1) {
              //Check if the current line is for retail. This has a different format of serial number, hence the separation
              po.selectLine({ sublistId: "item", line: x });
              lineQuantity = po.getCurrentSublistValue({
                sublistId: "item",
                fieldId: "quantity",
              });
              var invDetail = po.getCurrentSublistSubrecord({
                sublistId: "item",
                fieldId: "inventorydetail",
              });
              //Add the generated Product Codes to the subrecord
              for (var y = 0; y < lineQuantity; y++) {
                invDetail.selectNewLine({ sublistId: "inventoryassignment" });
                invDetail.setCurrentSublistValue({
                  sublistId: "inventoryassignment",
                  fieldId: "receiptinventorynumber",
                  value: "ABC" + y, //Generate the Product Code here
                });
                invDetail.commitLine({ sublistId: "inventoryassignment" });
              }
              po.commitLine({ sublistId: "item" });
            } else if (sampleLine > -1) {
              //Check if the current line is for sample
            }

            //Reset the field values
            retailLine = -1;
            sampleLine = -1;
          }

          //Save the record
          po.save();
        } else {
          status = "noresult";
        }
      } else {
        //User cancelled
        console.log("User cancelled.", result);
        status = "cancelled";
      }

      postProcessing(status);
    }

    function postProcessing(result) {
      console.log("Post processing", result);
      if (result == "noresult") {
        dialog.alert({
          title: "Alert",
          message:
            "There are no applicable items for processing the Product Code generation.",
        });
      } else if (result == "cancelled") {
        dialog.alert({
          title: "Notice",
          message: "Cancelled operation. Product codes are not generated.",
        });
      }
    }

    dialog.confirm(options).then(success);
  }
  return {
    pageInit: pageInit,
    generateFlow: generateFlow,
  };
});
