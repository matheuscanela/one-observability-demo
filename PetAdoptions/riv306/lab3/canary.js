var synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const recordedScript = async function () {
    let page = await synthetics.getPage();

    const navigationPromise = page.waitForNavigation()

    await synthetics.executeStep('GoToPetSite', async function () {
        await page.goto("http://servi-petsi-18fdk93jpfvfi-1319615776.us-east-1.elb.amazonaws.com/", { waitUntil: 'domcontentloaded', timeout: 60000 })
    })

    await page.setViewport({ width: 1080, height: 1763 })

    await navigationPromise

    let buttonFound = false;
    let secondRun = false
    let loops = 0
    do {

        if (secondRun == true) {
            await synthetics.executeStep('GoToPetSite_' + loops, async function () {
                await page.goto("http://servi-petsi-18fdk93jpfvfi-1319615776.us-east-1.elb.amazonaws.com/", { waitUntil: 'domcontentloaded', timeout: 60000 })              
            })
        }

        buttonFound = false;
        await synthetics.executeStep('TakeMeHome' + loops, async function () {

            console.log("Loading Pet Items")
            const petItems = await page.$$('.pet-item');
            console.log(petItems)

            for (const petItem of petItems) {
                // Find the first "pet-button" element within the current "pet-item"
                const petButton = await petItem.$('.pet-button');

                if (petButton) {
                    // Click the "pet-button" element if it exists
                    await petButton.click();

                    buttonFound = true;
                    console.log('Clicked the "Take me home" button in a pet item.');
                    
                    break;

                } else {
                    console.log('No "pet-button" found in this pet item.');
                }
            }

        })

        await navigationPromise

        await synthetics.executeStep('ClickBuy' + loops, async function () {
            await page.waitForSelector('.container > .row > .col-xs-12 > form > .btn')
            await page.click('.container > .row > .col-xs-12 > form > .btn')
        })

        await navigationPromise
        secondRun = true
        loops= loops + 1;

    } while (buttonFound);

};
exports.handler = async () => {
    return await recordedScript();
};