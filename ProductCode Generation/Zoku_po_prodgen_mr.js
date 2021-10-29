/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(["N/file", "N/record", "N/runtime", "N/search"], /**
 * @param {file} file
 * @param {record} record
 * @param {runtime} runtime
 * @param {search} search
 */ function (file, record, runtime, search) {
  /**
   * Marks the beginning of the Map/Reduce process and generates input data.
   *
   * @typedef {Object} ObjectRef
   * @property {number} id - Internal ID of the record instance
   * @property {string} type - Record type id
   *
   * @return {Array|Object|Search|RecordRef} inputSummary
   * @since 2015.1
   */
  function getInputData() {
    log.debug("getInputData", "*** START SCRIPT ***");
    try {
      var scriptObj = runtime.getCurrentScript();
      var internalid = scriptObj.getParameter({
        name: "custscript_zoku_poid",
      });

      //Use the local script saved search
      var itemLineId = new Array();

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
      var searchResultCount = transactionSearchObj.runPaged().count;

      if (searchResultCount > 0) {
        transactionSearchObj.run().each(function (result) {
          itemLineId.push(result.getValue({ name: "line" }));
          return true;
        });

        return itemLineId;
      }
    } catch (e) {
      log.error("Error on GETINPUTDATA", e);
    }
  }

  /**
   * Executes when the map entry point is triggered and applies to each key/value pair.
   *
   * @param {MapSummary} context - Data collection containing the key/value pairs to process through the map stage
   * @since 2015.1
   */

  function map(context) {
    try {
      //Placeholder for passing the data to the "reduce" stage
      var customRecordDetails = new Array();

      //The internal ID of the PO record from the parameter
      var scriptObj = runtime.getCurrentScript();
      var internalid = scriptObj.getParameter({
        name: "custscript_zoku_poid",
      });

      //Log the result of the search
      var lineId = JSON.parse(context.value);
      log.debug("MAP - lineId", lineId);

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

      log.debug("poStatus", poStatus);
      //This means this would be a newly generated Product/Serial Code
      if (poStatus == "1" || poStatus == "") {
        log.debug("Inside the NEW processing", lineCount);
        //Find the line where the items would have the Product Codes
        for (var x = 0; x < lineCount; x++) {
          log.audit("current line new", x);
          //Get the index of the item to match if it's same with the result of the savedsearch from getInputData
          itemLine = po.getSublistValue({
            sublistId: "item",
            fieldId: "line",
            line: x,
          });
          log.audit("itemLine | lineId", itemLine + " | " + lineId);

          //-1 means that this line is not it. If it's greater than -1, there is a result, therefore this matches what we're looking for
          if (itemLine == lineId) {
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
            var productDetails = getProductDetails(itemId);
            // log.debug("productDetails", productDetails);
            var finalRunningNumber = 0;

            //Add the generated Product Codes to the subrecord
            for (var y = 0; y < lineQuantity; y++) {
              //Get the product code generation
              var generatedCodes = productCodeGeneration(
                Number(productDetails.custitem_zoku_runningnumber) + y,
                productDetails["custitem_zoku_prodcodetype"][0]["value"],
                productDetails.itemid
              );

              //Add the product codes to the inventory detail subrecord
              invDetail.selectNewLine({ sublistId: "inventoryassignment" });
              invDetail.setCurrentSublistValue({
                sublistId: "inventoryassignment",
                fieldId: "receiptinventorynumber",
                value: generatedCodes[0],
              });

              // log.debug(
              //   "short code | long code",
              //   generatedCodes[0] + " | " + generatedCodes[1]
              // );
              //Commit the subrecord
              invDetail.commitLine({ sublistId: "inventoryassignment" });

              //If there's no problem there, proceed with the creation of the custom record
              // createCustomRecord(
              //   itemId,
              //   internalid,
              //   generatedCodes[0],
              //   generatedCodes[1],
              //   po.getValue({
              //     fieldId: "custbody_altas_anz_so_po_notes",
              //   }),
              //   lineId
              // );
              customRecordDetails.push([
                customRecordDetails.length,
                itemId,
                internalid,
                generatedCodes[0],
                generatedCodes[1],
                po.getValue({ fieldId: "custbody_altas_anz_so_po_notes" }),
                lineId,
              ]);

              //Count the final running number before saving the updated serialized item
              finalRunningNumber =
                Number(productDetails.custitem_zoku_runningnumber) + y + 1;
            }
            //Commit the item line
            po.commitLine({ sublistId: "item" });

            //Submit the serialized item updates
            log.debug("runningNumber", finalRunningNumber);
            record.submitFields({
              type: record.Type.SERIALIZED_INVENTORY_ITEM,
              id: itemId,
              values: {
                custitem_zoku_runningnumber: finalRunningNumber,
              },
              options: {
                ignoreMandatoryFields: true,
              },
            });
          }

          //Reset the field values
          itemLine = -1;
        }

        //Save the record
        //Set the status to '3', or 'Generated'
        po.setValue({
          fieldId: "custbody_zoku_codegen_status",
          value: "6",
        });
        //Set the status to 'Done Processing'
        po.setValue({
          fieldId: "custbody_zoku_backend_status",
          value: "3",
        });
        po.save();
      }
      //This means it's incomplete. This requires additional processing before generating the product codes
      else if (poStatus == "2" || poStatus == "6") {
        //Loop through the lines that are applicable for code generation
        log.debug("Inside the INCOMPLETE processing", lineCount);
        for (var x = 0; x < lineCount; x++) {
          log.audit("current line incomplete", x);
          //Get the index of the item to match if it's same with the result of the savedsearch from getInputData
          itemLine = po.getSublistValue({
            sublistId: "item",
            fieldId: "line",
            line: x,
          });
          log.audit("itemLine | lineId", itemLine + " | " + lineId);

          //-1 means that this line is not it. If it's greater than -1, there is a result, therefore this matches what we're looking for
          if (itemLine == lineId) {
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
            var productDetails = getProductDetails(itemId);
            log.debug("productDetails", productDetails);
            var finalRunningNumber = 0;

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
                search.createColumn({
                  name: "custrecord_zoku_serialnumber",
                }),
              ],
            });
            var toAdd = codeMatchSearch.runPaged().count;

            //This would be how many we'd need to add. (Item quantity - Count of currently generated codes)
            toAdd = lineQuantity - toAdd;

            //Add the generated Product Codes to the subrecord
            for (var y = 0; y < toAdd; y++) {
              var generatedCodes = productCodeGeneration(
                Number(productDetails.custitem_zoku_runningnumber) + y,
                productDetails["custitem_zoku_prodcodetype"][0]["value"],
                productDetails.itemid
              );

              //Add the product codes to the inventory detail subrecord
              invDetail.selectNewLine({ sublistId: "inventoryassignment" });
              invDetail.setCurrentSublistValue({
                sublistId: "inventoryassignment",
                fieldId: "receiptinventorynumber",
                value: generatedCodes[0],
              });

              // log.debug(
              //   "short code | long code",
              //   generatedCodes[0] + " | " + generatedCodes[1]
              // );
              //Commit the subrecord
              invDetail.commitLine({ sublistId: "inventoryassignment" });

              //If there's no problem there, proceed with the creation of the custom record
              // createCustomRecord(
              //   itemId,
              //   internalid,
              //   generatedCodes[0],
              //   generatedCodes[1],
              //   po.getValue({
              //     fieldId: "custbody_altas_anz_so_po_notes",
              //   }),
              //   lineId
              // );
              customRecordDetails.push([
                customRecordDetails.length,
                itemId,
                internalid,
                generatedCodes[0],
                generatedCodes[1],
                po.getValue({ fieldId: "custbody_altas_anz_so_po_notes" }),
                lineId,
              ]);

              //Count the final running number before saving the updated serialized item
              finalRunningNumber =
                Number(productDetails.custitem_zoku_runningnumber) + y + 1;
            }
            //Commit the item line
            po.commitLine({ sublistId: "item" });

            //Submit the serialized item updates
            log.debug("runningNumber", finalRunningNumber);
            record.submitFields({
              type: record.Type.SERIALIZED_INVENTORY_ITEM,
              id: itemId,
              values: {
                custitem_zoku_runningnumber: finalRunningNumber,
              },
              options: {
                ignoreMandatoryFields: true,
              },
            });
          }
          //Reset the field values
          itemLine = -1;
        }
        //Save the record
        //Set the status to '3', or 'Generated'
        po.setValue({
          fieldId: "custbody_zoku_codegen_status",
          value: "6",
        });
        //Set the status to 'Done Processing'
        po.setValue({
          fieldId: "custbody_zoku_backend_status",
          value: "3",
        });
        po.save();

        log.debug("save record completed", customRecordDetails.length);
      }
      //Loop the current list of the custom records to be passed for creation on the "Reduce" part of the script
      for (var ctr = 0; ctr < customRecordDetails.length; ctr++) {
        context.write({
          key: customRecordDetails[ctr][0],
          value: customRecordDetails[ctr],
        });
      }
    } catch (e) {
      log.error("Error in MAP", e);
    }
  }

  /**
   * Executes when the reduce entry point is triggered and applies to each group.
   *
   * @param {ReduceSummary} context - Data collection containing the groups to process through the reduce stage
   * @since 2015.1
   */
  function reduce(context) {
    //TODO: Add the reduce function for actual record saving. Further prevents script limits
    var dataValues = context.values.map(JSON.parse);
    // log.debug("REDUCE - dataValues", dataValues[0][4]);

    createCustomRecord(
      dataValues[0][1],
      dataValues[0][2],
      dataValues[0][3],
      dataValues[0][4],
      dataValues[0][5],
      dataValues[0][6]
    );

    context.write({
      key: dataValues[0][1],
      value: dataValues[0][2],
    });
  }

  /**
   * Executes when the summarize entry point is triggered and applies to the result set.
   *
   * @param {Summary} summary - Holds statistics regarding the execution of a map/reduce script
   * @since 2015.1
   */
  function summarize(context) {
    log.audit("Summary Data", context);
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
  function productCodeGeneration(runningNumber, itemProductType, itemId) {
    //function productCodeGeneration(productDetails, itemId) {
    var shortProductCode = "";
    var longProductCode = "";
    var productRunning = runningNumber; //productDetails.custitem_zoku_runningnumber;
    var productType = itemProductType; //productDetails["custitem_zoku_prodcodetype"][0]["value"]; //Either 1 = 'Retail' or 2 = 'Sample'

    shortProductCode += itemId;
    longProductCode += itemId;
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

    //Save the item record with the new running value - TODO
    // record.submitFields({
    //   type: record.Type.SERIALIZED_INVENTORY_ITEM,
    //   id: itemId,
    //   values: {
    //     custitem_zoku_runningnumber: productRunning,
    //   },
    //   options: {
    //     ignoreMandatoryFields: true,
    //   },
    // });

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
    // log.debug("Custom record has been saved!");
  }

  return {
    getInputData: getInputData,
    map: map,
    reduce: reduce,
    summarize: summarize,
  };
});
