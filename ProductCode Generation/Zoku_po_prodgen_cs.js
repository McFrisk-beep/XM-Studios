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
          columns: [search.createColumn({ name: "line", label: "Line ID" })],
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
            //Get the index of the serialized item
            itemLine = itemLineId.indexOf(
              po.getSublistValue({
                sublistId: "item",
                fieldId: "line",
                line: x,
              })
            );

            //-1 means that this line is not it. If it's greater than -1, there is a result, therefore this matches what we're looking for
            if (itemLine > -1) {
              //Get item line quantity
              po.selectLine({ sublistId: "item", line: x });
              lineQuantity = po.getCurrentSublistValue({
                sublistId: "item",
                fieldId: "quantity",
              });

              //Search if the product code was already generated previously.
              // var zokuProductCodeSearch = search.create({
              //   type: "customrecord_zoku_prodcode_custrec",
              //   filters: [
              //     ["custrecord_zoku_item", "anyof", "51"],
              //     "AND",
              //     ["custrecord_zoku_source", "anyof", "355"],
              //   ],
              //   columns: [
              //     search.createColumn({
              //       name: "id",
              //       sort: search.Sort.ASC,
              //       label: "ID",
              //     }),
              //   ],
              // });
              // var productCodeMatches = zokuProductCodeSearch.runPaged().count;

              // if (productCodeMatches > 0) {
              //   if (productCodeMatches > lineQuantity) {
              //     //If the productCodeMatces has more items than the current line quantity, DECREASE the custom record count
              //   } else if (productCodeMatches < lineQuantity) {
              //     //If the productCodeMatches has less items than the current line quantity, INCREASE the custom record count.
              //     //Proceed with the creation of the custom record
              //   } else if (productCodeMatches == lineQuantity) {
              //     //If both the productCodeMatches and the current line quantity is equal. DO NOTHING.
              //   }
              // }

              var invDetail = po.getCurrentSublistSubrecord({
                sublistId: "item",
                fieldId: "inventorydetail",
              });
              //Add the generated Product Codes to the subrecord
              for (var y = 0; y < lineQuantity; y++) {
                //Get the product information (Item ID, running number, product category)
                var currentLineItem = po.getSublistValue({
                  sublistId: "item",
                  fieldId: "item",
                  line: x,
                });
                var productDetails = getProductDetails(currentLineItem);
                console.log("productDetails", productDetails);

                //Get the product code generation
                var generatedCodes = productCodeGeneration(
                  productDetails,
                  currentLineItem
                );

                //Add the product codes to the inventory detail subrecord
                invDetail.selectNewLine({ sublistId: "inventoryassignment" });
                invDetail.setCurrentSublistValue({
                  sublistId: "inventoryassignment",
                  fieldId: "receiptinventorynumber",
                  value: generatedCodes[0],
                });

                console.log("short code", generatedCodes[0]);
                console.log("long code", generatedCodes[1]);
                //Commit the subrecord
                invDetail.commitLine({ sublistId: "inventoryassignment" });

                //If there's no problem there, proceed with the creation of the custom record
                // createCustomRecord(
                //   currentLineItem,
                //   internalid,
                //   generatedCodes[0],
                //   generatedCodes[1],
                //   po.getValue({
                //     fieldId: "custbody_altas_anz_so_po_notes",
                //   }),
                //   "NOTES"
                // );
              }
              //Commit the item line
              po.commitLine({ sublistId: "item" });
            }

            //Reset the field values
            itemLine = -1;
          }

          //Save the record
          // po.save();
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

  /*
    Creates the custom record storing the generated fields from the item subrecord

    params:
    currentLineItem - the current line item
    internalid - internal id of the item
    shortCode - the serial number
    longCode - the product number
    fieldNotes - notes from the purchase order
    member - the member type of the customer
  */
  function createCustomRecord(
    currentLineItem,
    internalid,
    shortCode,
    longCode,
    fieldNotes,
    member
  ) {
    var custRecord = record.create({
      type: "customrecord_zoku_prodcode_custrec",
    });
    custRecord.setValue({
      fieldId: "custrecord_zoku_item",
      value: currentLineItem,
    });
    custRecord.setValue({
      fieldId: "custrecord_zoku_source",
      value: internalid,
    });
    custRecord.setValue({
      fieldId: "custrecord_zoku_serialnumber",
      value: shortCode,
    });
    custRecord.setValue({
      fieldId: "custrecord_zoku_prodcode",
      value: longCode,
    });
    custRecord.setValue({
      fieldId: "custrecord_zoku_notes",
      value: fieldNotes,
    });
    custRecord.setValue({
      fieldId: "custrecord_zoku_member",
      value: member,
    });
    custRecord.save();
    console.log("Custom record has been saved!");
  }

  return {
    pageInit: pageInit,
    generateFlow: generateFlow,
  };
});
