/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define([
  "N/record",
  "N/search",
  "./sweetalert2.all.min.js",
  "N/runtime",
  "N/url",
  "N/https",
], /**
 * @param {record} record
 * @param {search} search
 * @param {dialog} dialog
 */ function (record, search, Swal, runtime, nUrl, https) {
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
    var itemLineId = new Array();

    //Display confirmation dialog
    Swal.fire({
      title: "Are you sure?",
      html:
        "<p>Once confirmed, this will generate the Serial Codes for all applicable items in the transaction.</p>" +
        "<p><br></p>" +
        "<p>Please make sure that there are no further changes to the transaction before proceeding.</p>" +
        "<p><br></p>" +
        "<p>The screen may freeze while the Serial Codes are being generated.&nbsp;</p>" +
        "<p><br></p>" +
        "<p><b>PLEASE DO NOT CLOSE THE WINDOW</b> until the confirmation dialog appears.</p>" +
        "<p><br></p>" +
        "<p>Confirm Serial Code generation?</p>",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Yes, generate the Serial Codes!",
      willClose: Swal.showLoading(),
    }).then(loadingDialog);

    //Display loading dialog
    function loadingDialog(result) {
      if (result.isConfirmed) {
        //Check how many would need to be processed. If it's more than 5, pass it to the Map/Reduce script
        var countApplicable = checkApplicableProducts(internalid);
        var totalQuantity = checkApplicableProductsQuantity(internalid);
        console.log("Total item quantity", totalQuantity);
        if (countApplicable > 5 || totalQuantity > 25) {
          //Set the back-end status of the record to 'Processing' (ID 2)
          record.submitFields({
            type: record.Type.PURCHASE_ORDER,
            id: internalid,
            values: {
              custbody_zoku_backend_status: 2,
            },
            options: {
              ignoreMandatoryFields: true,
            },
          });

          //Since n/task is not supported for client scripts, we delegate the trigger to a Suitelet instead
          var suiteletURL = nUrl.resolveScript({
            scriptId: "customscript_zoku_prodcodgen_sl",
            deploymentId: "customdeploy_zoku_sl_deployment",
          });
          //Add the parameter used for the Map/Reduce script
          suiteletURL += "&internalid=" + internalid;

          console.log("Suitelet trigger parameters", suiteletURL);

          //Call the Suitelet
          var response = https.get({
            url: suiteletURL,
          });
          console.log("Suitelet Response", response);

          Swal.fire({
            title: "Job sent to the back-end!",
            icon: "info",
            html: "<p>The system determined that there are a lot of items to be processed.</p><br/><br/><p>This task is delegated to NetSuite&apos;s Back-end script for processing.</p><br/><br/><p>The record will not allow modifications so long as the <b>Code Generation Status</b> is set to <b>Processing</b>.</p><br/><br/><p>Please check back later on this transaction record.</p>",
          }).then(onDismiss);

          function onDismiss() {
            location.reload();
          }
        } else {
          Swal.fire({
            title: "Processing Serial Codes!",
            // icon: "info",
            html:
              "<head><meta name='viewport' content='width=device-width, initial-scale=1'><style>.loader{border:16px solid #f3f3f3;border-radius:50%;border-top:16px solid #3498db;width:60px;height:60px;-webkit-animation:spin 2s linear infinite;animation:spin 2s linear infinite;margin-left:auto;margin-right:auto}@-webkit-keyframes spin{0%{-webkit-transform:rotate(0deg)}100%{-webkit-transform:rotate(360deg)}}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style></head><body><div class='loader'></div></body><br/><br/><b>Do not close this window!</br>" +
              "Please wait. . .",
            allowOutsideClick: false,
            allowEscapeKey: false,
            showCancelButton: false,
            showConfirmButton: false,
            timer: 100,
            // timerProgressBar: true,
          }).then(proceedProcessing);
        }
      } else {
        Swal.fire(
          "Cancelled!",
          "Operation has been cancelled. No Serial Codes have been generated.",
          "info"
        );
      }
    }

    //Process the record in the background
    function proceedProcessing(result) {
      Swal.fire({
        title: "Processing completed!",
        icon: "success",
        html: "Serial Codes have been generated! Click 'OK' to reload the page.",
        preConfirm: processCodes(true),
        allowOutsideClick: false,
        allowEscapeKey: false,
        showCancelButton: false,
      }).then(onDismiss);

      function onDismiss() {
        console.log("Finished processing.");
        location.reload();
      }
    }

    function processCodes(result) {
      Swal.showLoading();
      //function success(result) {
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
          var poStatus = po.getValue({
            fieldId: "custbody_zoku_codegen_status",
          });
          var lineCount = po.getLineCount({ sublistId: "item" });
          var lineQuantity = 0;
          var itemLine = -1;

          //This means this would be a newly generated Product/Serial Code
          if (poStatus == "1" || poStatus == "") {
            console.log("Inside the NEW processing");
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
                  createCustomRecord(
                    currentLineItem,
                    internalid,
                    generatedCodes[0],
                    generatedCodes[1],
                    po.getValue({
                      fieldId: "custbody_altas_anz_so_po_notes",
                    }),
                    po.getSublistValue({
                      sublistId: "item",
                      fieldId: "line",
                      line: x,
                    })
                  );
                }
                //Commit the item line
                po.commitLine({ sublistId: "item" });
              }

              //Reset the field values
              itemLine = -1;

              //Check script governance
              var scriptObj = runtime.getCurrentScript();
              console.log(
                "Governance remaining",
                scriptObj.getRemainingUsage()
              );
            }

            //Save the record
            po.setValue({
              fieldId: "custbody_zoku_codegen_status",
              value: "3",
            }); //Set the status to '3', or 'Generated'
            po.save();
          }
          //This means it's incomplete. This requires additional processing before generating the product codes
          else if (poStatus == "2") {
            //Loop through the lines that are applicable for code generation
            console.log("Inside the INCOMPLETE processing");
            for (var x = 0; x < lineCount; x++) {
              //Check if the line ID exists
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
                var lineId = po.getCurrentSublistValue({
                  sublistId: "item",
                  fieldId: "line",
                });
                var itemId = po.getCurrentSublistValue({
                  sublistId: "item",
                  fieldId: "item",
                });
                var invDetail = po.getCurrentSublistSubrecord({
                  sublistId: "item",
                  fieldId: "inventorydetail",
                });
                var codeMatch = new Array();
                // var subrecordCount;

                //Create a search to look for codes (if any) that is linked to the item record
                var codeMatchSearch = search.create({
                  type: "customrecord_zoku_prodcode_custrec",
                  filters: [
                    ["custrecord_zoku_source", "anyof", internalid],
                    "AND",
                    ["custrecord_zoku_lineid", "is", lineId],
                    "AND",
                    ["custrecord_zoku_item", "anyof", itemId],
                    "AND",
                    ["isinactive", "is", "F"],
                  ],
                  columns: [
                    // search.createColumn({ name: "id" }),
                    // search.createColumn({ name: "custrecord_zoku_item" }),
                    // search.createColumn({ name: "custrecord_zoku_lineid" }),
                    search.createColumn({
                      name: "custrecord_zoku_serialnumber",
                    }),
                  ],
                });
                var toAdd = codeMatchSearch.runPaged().count;
                codeMatchSearch.run().each(function (result) {
                  codeMatch.push(
                    result.getValue({ name: "custrecord_zoku_serialnumber" })
                  );
                  return true;
                });

                // subrecordCount = invDetail.getLineCount({
                //   sublistId: "inventoryassignment",
                // });

                //This would be how many we'd need to add. (Item quantity - Count of currently generated codes)
                toAdd = lineQuantity - toAdd;

                //Add the generated Product Codes to the subrecord
                for (var y = 0; y < toAdd; y++) {
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
                  createCustomRecord(
                    currentLineItem,
                    internalid,
                    generatedCodes[0],
                    generatedCodes[1],
                    po.getValue({
                      fieldId: "custbody_altas_anz_so_po_notes",
                    }),
                    po.getSublistValue({
                      sublistId: "item",
                      fieldId: "line",
                      line: x,
                    })
                  );
                }
                //Commit the item line
                po.commitLine({ sublistId: "item" });
              }
              //Reset the field values
              itemLine = -1;

              var scriptObj = runtime.getCurrentScript();
              console.log(
                "Governance remaining",
                scriptObj.getRemainingUsage()
              );
            }
            //Save the record
            po.setValue({
              fieldId: "custbody_zoku_codegen_status",
              value: "3",
            }); //Set the status to '3', or 'Generated'
            po.save();
          }
        } else {
        }
      } else {
        //User cancelled
        console.log("User cancelled.", result);
      }
    }

    //dialog.confirm(options).then(success);
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
    productType - the type of the serialized item if it is Retail or Sample

    returns:
    formattedSuffix - the text that would be stored for the item
  */
  function formatRunningSuffix(runningNumber, productType) {
    var str = "" + runningNumber;
    var pad = "0000";
    var formattedSuffix;

    //'Sample' Item type has an additional letter prefix, so the pad is limited to 3-digits.
    if (productType == "2") {
      pad = "000";
    }

    //Format the suffixes
    formattedSuffix = pad.substring(0, pad.length - str.length) + str;

    //Once everything is done, add the 'R' suffix for the 'Sample' Item type
    if (productType == "2") {
      formattedSuffix = "R" + formattedSuffix;
    }

    return formattedSuffix;
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
    See how many items will need to be processed.

    params:
    internalid - the internal id of the PO record

    returns:
    int - the number of the search results applicable for processing
  */
  function checkApplicableProducts(internalid) {
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
        ["formulatext: {item.custitem_zoku_prodcodetype}", "isnotempty", ""],
      ],
      columns: [search.createColumn({ name: "line", label: "Line ID" })],
    });
    return transactionSearchObj.runPaged().count;
  }

  /*
    See how many items will need to be processed.

    params:
    internalid - the internal id of the PO record

    returns:
    int - the number of the search results applicable for processing
  */
  function checkApplicableProductsQuantity(internalid) {
    var transactionSearchObj = search.create({
      type: "transaction",
      filters: [
        ["internalidnumber", "equalto", internalid],
        "AND",
        ["mainline", "is", "F"],
        "AND",
        ["item.type", "anyof", "InvtPart"],
        "AND",
        ["item.isserialitem", "is", "T"],
        "AND",
        ["formulatext: {item.custitem_zoku_prodcodetype}", "isnotempty", ""],
      ],
      columns: [search.createColumn({ name: "quantity", label: "Quantity" })],
    });
    var totalCount = 0;
    transactionSearchObj.run().each(function (result) {
      totalCount += Math.abs(Number(result.getValue({ name: "quantity" })));
      return true;
    });
    return totalCount;
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

    returns:
    null
  */
  function createCustomRecord(
    currentLineItem,
    internalid,
    shortCode,
    longCode,
    fieldNotes,
    lineId
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
      fieldId: "custrecord_zoku_lineid",
      value: lineId,
    });
    custRecord.save();
    console.log("Custom record has been saved!");
  }

  return {
    pageInit: pageInit,
    generateFlow: generateFlow,
  };
});
