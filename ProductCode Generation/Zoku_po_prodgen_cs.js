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
    var itemLineId = new Array();
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
          itemLineId.push(result.getValue({ name: "line" }));
          return true;
        });
        console.log("itemLineId", itemLineId);

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
          var itemLine = -1;

          //Find the line where the items would have the Product Codes
          for (var x = 0; x < lineCount; x++) {
            //Separated these to variables to make the if-statements easier to read
            itemLine = itemLineId.indexOf(
              po.getSublistValue({
                sublistId: "item",
                fieldId: "line",
                line: x,
              })
            );

            if (itemLine > -1) {
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
                //Get the product information (Item ID, running number, product category)
                var productDetails = getProductDetails(
                  po.getSublistValue({
                    sublistId: "item",
                    fieldId: "item",
                    line: x,
                  })
                );
                console.log("productDetails", productDetails);

                var generatedCodes = productCodeGeneration(
                  productDetails,
                  po.getSublistValue({
                    sublistId: "item",
                    fieldId: "item",
                    line: x,
                  })
                );

                invDetail.selectNewLine({ sublistId: "inventoryassignment" });
                invDetail.setCurrentSublistValue({
                  sublistId: "inventoryassignment",
                  fieldId: "receiptinventorynumber",
                  value: generatedCodes[0],
                });

                console.log("short code", generatedCodes[0]);
                console.log("long code", generatedCodes[1]);
                invDetail.commitLine({ sublistId: "inventoryassignment" });
              }
              po.commitLine({ sublistId: "item" });
            }

            //Reset the field values
            itemLine = -1;
          }

          //Save the record
          //po.save();
          status = "successful";
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

    /*
      Returns a message to the user notifying them what happened to their button click, after the product code generation is selected

      params:
      result - result code to identify what happened

      returns:
      none. dialog response displayed.
    */
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
      } else if (result == "successful") {
        dialog.alert({
          title: "Record Saved",
          message:
            "The Purchase Order has been successfully updated. Product Codes successfully generated.",
        });
      }
    }

    dialog.confirm(options).then(success);
  }

  /*
    Does a lookup search for the item details required for the productCode generation

    params:
    internalId - internal ID of the item record to be looked-up

    returns:
    itemid - text
    custitem_zoku_runningnumber - text
    custitem_zoku_prodcodetype - list type
  */
  function getProductDetails(internalId) {
    return search.lookupFields({
      type: search.Type.SERIALIZED_INVENTORY_ITEM,
      id: internalId,
      columns: [
        "itemid",
        "custitem_zoku_runningnumber",
        "custitem_zoku_prodcodetype",
      ],
    });
  }

  /*
    Generates the Running suffix to be returned for part of the productCode generation

    params:
    runningNumber - the running number of the item being referenced

    returns:
    pad.substring - the text that would be stored for the item
  */
  function formatRunningSuffix(runningNumber, productType) {
    var str = "" + runningNumber;
    var pad = "0000";

    //TODO - The 'R' is removed after 999. Needs fixing in the future. Will leave it for now as is,
    if (productType == "2") {
      pad = "R000";
    }

    return pad.substring(0, pad.length - str.length) + str;
  }

  /*
    Generates the Product Code to be saved for the Purchase order and the Custom Record

    params:
    productDetails - lookup results of the item record
    itemId - item internal ID

    returns:
    productCode - text
  */
  function productCodeGeneration(productDetails, itemId) {
    var shortProductCode = "";
    var longProductCode = "";
    var productRunning = productDetails.custitem_zoku_runningnumber;
    var productType = productDetails["custitem_zoku_prodcodetype"][0]["value"]; //Either 1 = 'Retail' or 2 = 'Sample'
    console.log("productType", productType);

    shortProductCode += productDetails.itemid;
    longProductCode += productDetails.itemid;
    longProductCode +=
      "-" + randomTextGeneration() + "-" + randomTextGeneration();

    //Check if there's a running number existing on the item
    if (productRunning === "") {
      shortProductCode += "-" + formatRunningSuffix(0, productType);
      longProductCode += "-" + formatRunningSuffix(0, productType);
      productRunning = 1;
    } else {
      productRunning++;
      shortProductCode +=
        "-" + formatRunningSuffix(productRunning, productType);
      longProductCode += "-" + formatRunningSuffix(productRunning, productType);
    }

    //Save the item record with the new running value
    record.submitFields({
      type: record.Type.SERIALIZED_INVENTORY_ITEM,
      id: itemId,
      values: {
        custitem_zoku_runningnumber: productRunning,
      },
      options: {
        ignoreMandatoryFields: true,
      },
    });

    //Return the short product code
    return [shortProductCode, longProductCode];
  }

  /*
    Generates a random alphanumeric string (a-z, A-Z, 0-9)

    params: none
    returns:
    result - the text used for population of the long version of the product code
  */
  function randomTextGeneration() {
    var length = 4;
    var chars =
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var result = "";
    for (var i = length; i > 0; --i)
      result += chars[Math.round(Math.random() * (chars.length - 1))];
    return result.toUpperCase();
  }

  return {
    pageInit: pageInit,
    generateFlow: generateFlow,
  };
});
